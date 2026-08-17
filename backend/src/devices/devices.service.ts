import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Device } from '../entities/device.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { ForgottenDevice } from '../entities/forgotten-device.entity';
import { DeviceAlias } from '../entities/device-alias.entity';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from '../network/network-provider.interface';
import {
  ROUTER_PROVIDER,
  RouterProvider,
} from '../router/router-provider.interface';
import { EventsGateway } from '../events/events.gateway';
import { ProfilesService } from '../profiles/profiles.service';
import { isRandomizedMac, normalizeMac } from '../common/mac.util';
import { generateClientId } from '../common/client-id.util';
import { lookupVendor, vendorLabel } from '../common/oui';
import { decodeModel, kindIcon } from '../common/device-model';
import {
  isNonDeviceAddress,
  isPlaceholderName,
  isSelfAssignedName,
  resolveHostname,
} from '../common/hostname.util';
import { UpdateDeviceDto } from './dto/device.dto';

/**
 * Owns the device inventory. `syncFromNetwork()` is the reconciliation entry
 * point: it pulls what the appliance sees, upserts each device, flags MAC
 * randomization, and raises alerts for brand-new / evasive devices. Called on a
 * schedule (SchedulerService) and on-demand from the controller.
 */
/**
 * How long an unnamed, MAC-less, unassigned address may go unseen before it is
 * treated as a dead lease rather than a device.
 */
const GHOST_DAYS = 7;

@Injectable()
export class DevicesService implements OnModuleInit {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(ActivityLog) private activity: Repository<ActivityLog>,
    @InjectRepository(ForgottenDevice)
    private forgotten: Repository<ForgottenDevice>,
    @InjectRepository(DeviceAlias)
    private aliases: Repository<DeviceAlias>,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    @Inject(ROUTER_PROVIDER) private router: RouterProvider,
    private events: EventsGateway,
    private profiles: ProfilesService,
    private config: ConfigService,
  ) {}

  /** Backfill stable client ids for any device predating the column. */
  async onModuleInit(): Promise<void> {
    const missing = await this.devices.find({ where: { clientId: IsNull() } });
    for (const d of missing) {
      d.clientId = generateClientId(d.name || d.ipAddress);
      await this.devices.save(d);
    }
    if (missing.length) {
      this.logger.log(`Backfilled clientId for ${missing.length} device(s)`);
    }
  }

  /**
   * How long an online device may go without asking us to resolve anything
   * before we call it out. Chatty devices query constantly; even a fairly idle
   * phone checks in every few minutes. Twenty minutes of total silence from a
   * device the router says is connected means it is resolving somewhere else.
   */
  private static readonly FILTER_SILENCE_MINUTES = 20;

  /**
   * Devices, each annotated with whether the filter is actually seeing it.
   *
   * A device can be online, assigned to a profile, and showing blocked rules —
   * while quietly resolving through something else entirely (a lease that
   * predates a DNS change, or Private DNS/DoT on the device). Everything else
   * in the dashboard reports success in that state, which is how a household
   * can sit unprotected for an hour with nothing looking wrong.
   */
  async findAll(): Promise<
    Array<
      Device & {
        lastFilteredAt: string | null;
        usingFilter: boolean;
        vendorLabel: string;
        vendorKnown: boolean;
        macPrivate: boolean;
        modelCode: string | null;
        model: string | null;
        kind: string | null;
        kindIcon: string;
      }
    >
  > {
    const devices = await this.devices.find({
      relations: { profile: true },
      order: { lastSeenAt: 'DESC' },
    });

    // Last time each client actually asked us to resolve something. Matched by
    // IP as well as device id, since logs keep the id they were ingested with.
    const seen = await this.activity
      .createQueryBuilder('a')
      .select('a.clientIp', 'ip')
      .addSelect('MAX(a.timestamp)', 'last')
      .groupBy('a.clientIp')
      .getRawMany<{ ip: string; last: Date }>();
    const lastByIp = new Map(seen.map((r) => [r.ip, new Date(r.last)]));

    const cutoff = Date.now() - DevicesService.FILTER_SILENCE_MINUTES * 60_000;

    return devices.map((d) => {
      const last = lastByIp.get(d.ipAddress) ?? null;
      // A resolved query is proof the device was here at that instant —
      // stronger evidence than the router's table, which lags by minutes and
      // had a phone marked absent half an hour after it last asked us for a
      // name. Report whichever evidence is more recent.
      const seen = [d.lastSeenAt, last]
        .filter((v): v is Date => !!v)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      // Identity is derived, never stored: the OUI table and the model list
      // both improve over time, and a device should pick up a better answer on
      // the next page load rather than being stuck with whatever was known on
      // the day it was discovered.
      const vendor = vendorLabel(d.macAddress, d.vendor);
      const decoded = decodeModel(d.hostname ?? d.name);
      return Object.assign(d, {
        lastSeenAt: seen ?? null,
        vendorLabel: vendor.text,
        vendorKnown: vendor.known,
        macPrivate: vendor.private,
        modelCode: decoded.code,
        model: decoded.model,
        kind: decoded.kind,
        kindIcon: kindIcon(decoded.kind),
        lastFilteredAt: last ? last.toISOString() : null,
        // Only meaningful for devices that are actually here: an offline device
        // is silent for the obvious reason.
        usingFilter: !d.isOnline || (!!last && last.getTime() >= cutoff),
      });
    });
  }

  async findOne(id: string): Promise<Device> {
    const device = await this.devices.findOne({
      where: { id },
      relations: { profile: true },
    });
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    return device;
  }

  /**
   * Encrypted-DNS setup for a device: the DoT/DoH/DoQ endpoints (carrying the
   * device's stable ClientID) a parent configures on the device's OS so its
   * queries are attributed to it regardless of IP. Requires ADGUARD_DNS_DOMAIN
   * (your AdGuard server's public DNS hostname); null endpoints otherwise.
   */
  async getDnsSetup(id: string): Promise<{
    clientId: string;
    domainConfigured: boolean;
    dot: string | null;
    doh: string | null;
    doq: string | null;
  }> {
    const device = await this.findOne(id);
    if (!device.clientId) {
      device.clientId = generateClientId(device.name || device.ipAddress);
      await this.devices.save(device);
    }
    const domain = this.config.get<string>('ADGUARD_DNS_DOMAIN', '').trim();
    const cid = device.clientId;
    return {
      clientId: cid,
      domainConfigured: !!domain,
      dot: domain ? `${cid}.${domain}` : null,
      doh: domain ? `https://${domain}/dns-query/${cid}` : null,
      doq: domain ? `quic://${cid}.${domain}` : null,
    };
  }

  /**
   * Pull the network layer's device list and reconcile it into the DB.
   * Returns a summary for the controller/log. Idempotent.
   */
  async syncFromNetwork(): Promise<{ discovered: number; created: number }> {
    const discovered = (await this.network.discoverDevices()).filter(
      // Broadcast/multicast/loopback pseudo-clients are not devices a parent
      // can manage; AdGuard reports them and they only clutter the list.
      (d) => !isNonDeviceAddress(d.ip),
    );

    // Merge router DHCP leases (MAC-authoritative) — enrich MACs on devices
    // AdGuard saw by IP only, and add any the router sees that AdGuard didn't.
    if (this.router.isEnabled()) {
      const byIp = new Map(discovered.map((d) => [d.ip, d]));
      for (const lease of await this.router.listLeases()) {
        const existing = byIp.get(lease.ip);
        if (existing) {
          existing.mac = existing.mac ?? lease.mac;
          existing.name = existing.name ?? lease.hostname;
          // Seen resolving DNS ⇒ online, whatever the router's table says.
          existing.online = existing.online || lease.online === true;
          // Only the router knows any of this; AdGuard never supplies it.
          existing.connection = lease.connection ?? null;
          existing.ssid = lease.ssid ?? null;
          existing.addressSource = lease.addressSource ?? null;
        } else {
          const d = {
            ip: lease.ip,
            mac: lease.mac,
            name: lease.hostname,
            // The router feed includes devices that are switched off; recording
            // them as online would make the dashboard claim the whole house is
            // always connected.
            online: lease.online ?? true,
            // Being listed in the lease table is not the same as being here.
            // A switched-off device keeps its lease, so stamping "seen now"
            // for one is the difference between "off since Tuesday" and the
            // dashboard insisting it was here a minute ago.
            lastSeen: lease.online === false ? null : new Date(),
            connection: lease.connection ?? null,
            ssid: lease.ssid ?? null,
            addressSource: lease.addressSource ?? null,
          };
          discovered.push(d);
          byIp.set(lease.ip, d);
        }
      }
    }

    // Probe unnamed addresses concurrently. Sequential probes inside the loop
    // would add a timeout per device to every scan; here the whole batch costs
    // roughly one timeout. Best-effort: silent nulls on networks (like most
    // home LANs) that run neither a NetBIOS responder nor reverse DNS.
    const probeIps = discovered.filter((d) => !d.name).map((d) => d.ip);
    const probed = new Map<string, string>();
    await Promise.all(
      probeIps.map(async (ip) => {
        const name = await resolveHostname(ip);
        if (name) probed.set(ip, name);
      }),
    );

    let created = 0;
    // Set when a device that enforcement depends on changes address.
    let enforcementStale = false;
    /** Addresses live in THIS sweep — used to keep a merged row's address put. */
    const onlineIps = new Set(discovered.filter((x) => x.online).map((x) => x.ip));

    for (const d of discovered) {
      const mac = normalizeMac(d.mac);
      // Match on MAC first (stable). When a MAC arrives for the first time —
      // e.g. a router provider was just enabled — adopt the existing MAC-less
      // row for that IP instead of creating a duplicate alongside it. Only rows
      // with no MAC are adopted, so two devices that merely shared an IP over
      // time are never merged.
      const existing = mac
        ? (await this.devices.findOne({ where: { macAddress: mac } })) ??
          (await this.devices.findOne({
            where: { ipAddress: d.ip, macAddress: IsNull() },
          })) ??
          // A randomized MAC is not an identity: phones rotate it, and per-SSID
          // randomization means one device presents several. When the row on
          // this IP carries a randomized MAC, treat the new MAC as the same
          // device rather than spawning a duplicate — otherwise a rename the
          // parent made is stranded on the old row.
          (await this.devices.findOne({
            where: { ipAddress: d.ip, macRandomized: true },
          }))
        : await this.devices.findOne({ where: { ipAddress: d.ip } });

      // A merged-away identity still holds a DHCP lease the router reports for
      // days. Resolve it to the row it was merged into, or the merge is undone
      // on the next tick.
      const viaAlias = existing ? null : await this.resolveAlias(d.ip, mac);

      if (!existing && viaAlias) {
        // Recognised, not new. Two rules, both learned the hard way:
        //
        // An offline stale lease must not drag the surviving row back to an
        // address the device no longer holds.
        //
        // And a device can hold both addresses at once — per-SSID MAC
        // randomization means one phone appears on the 2.4 and 5 GHz networks
        // simultaneously. If both are live, the row must stay put rather than
        // ping-pong between them on every sync, which would make its address
        // depend on nothing but iteration order.
        if (d.online) {
          viaAlias.isOnline = true;
          viaAlias.lastSeenAt = d.lastSeen ?? new Date();
          const primaryStillLive = onlineIps.has(viaAlias.ipAddress);
          if (!primaryStillLive) viaAlias.ipAddress = d.ip || viaAlias.ipAddress;
        }
        await this.devices.save(viaAlias);
        continue;
      }

      if (existing) {
        // Enforcement rules are pinned to the IP (the ClientID only applies
        // once encrypted DNS is set up). If a blocked device gets a new lease,
        // its block silently points at the old address until something
        // re-pushes — so remember that we must.
        if (d.ip && d.ip !== existing.ipAddress) {
          enforcementStale =
            enforcementStale || existing.blocked || !!existing.profileId;
        }
        existing.ipAddress = d.ip || existing.ipAddress;
        existing.isOnline = d.online;
        // Only presence moves this clock. Discovery lists devices that are
        // switched off — they hold a DHCP lease and keep an AdGuard client
        // entry — so advancing last-seen for every row in the feed made every
        // offline device read "1m ago" forever, which is precisely as useful
        // as no timestamp at all. When it is gone, the old value stands.
        if (d.online) existing.lastSeenAt = d.lastSeen ?? new Date();
        if (mac) {
          existing.macAddress = mac;
          existing.macRandomized = isRandomizedMac(mac);
          // Re-derive every sync rather than only when empty: the OUI table
          // grows, and a row named from a thinner table should benefit from a
          // better one without being forgotten and rediscovered.
          existing.vendor = lookupVendor(mac) ?? existing.vendor;
        }
        // What the network calls it, kept whatever the parent renames it to.
        // Our own AdGuard client names come back through discovery; recording
        // one as "what this device announces" would be quoting ourselves.
        if (d.name && !isSelfAssignedName(d.name)) existing.hostname = d.name;
        if (d.connection !== undefined) existing.connectionType = d.connection;
        if (d.ssid !== undefined) existing.ssid = d.ssid;
        if (d.addressSource !== undefined) existing.addressSource = d.addressSource;
        // Upgrade auto-derived names when discovery learns something better.
        // A name the parent typed is never a placeholder, so it is never lost.
        if (isPlaceholderName(existing.name, existing.ipAddress, existing.vendor)) {
          const better =
            d.name ??
            probed.get(existing.ipAddress) ??
            (existing.vendor ? `${existing.vendor} device` : null);
          if (better) existing.name = better;
        }
        await this.devices.save(existing);
        continue;
      }

      // Was this explicitly forgotten? Honour that, unless the router is now
      // handing it a DHCP lease — a MAC is the proof that a real device lives
      // here, and virtual adapters never have one.
      if (!mac && (await this.isForgotten(d.ip, mac))) {
        continue;
      }
      if (mac && (await this.isForgotten(d.ip, mac))) {
        // A genuine LAN client came back; the tombstone has served its purpose.
        await this.clearTombstones(d.ip, mac);
      }

      const randomized = isRandomizedMac(mac);
      const vendor = lookupVendor(mac);
      // Name preference: what discovery reported → what the device answers to
      // (NetBIOS/rDNS) → "<Vendor> device" → bare IP as the last resort.
      const name =
        d.name || probed.get(d.ip) || (vendor ? `${vendor} device` : d.ip);
      const device = this.devices.create({
        name,
        clientId: generateClientId(name),
        ipAddress: d.ip,
        macAddress: mac,
        macRandomized: randomized,
        vendor,
        isOnline: d.online,
        // Same rule for a first sighting: a device discovered while switched
        // off has genuinely never been seen, and null renders as "never seen"
        // rather than inventing a moment it was here.
        lastSeenAt: d.online ? (d.lastSeen ?? new Date()) : (d.lastSeen ?? null),
        hostname: (d.name && !isSelfAssignedName(d.name) ? d.name : null) ?? probed.get(d.ip) ?? null,
        connectionType: d.connection ?? null,
        ssid: d.ssid ?? null,
        addressSource: d.addressSource ?? null,
      });
      const saved = await this.devices.save(device);
      created++;

      // Alert: a new device joined the network.
      this.events.emitAlert({
        type: randomized ? 'mac_randomized' : 'device_new',
        severity: randomized ? 'warning' : 'info',
        message: randomized
          ? `New device "${saved.name}" (${d.ip}) is using a RANDOMIZED MAC — it can evade MAC-based controls.`
          : `New device "${saved.name}" (${d.ip}) joined the network.`,
        deviceId: saved.id,
        at: new Date().toISOString(),
      });
    }

    // Drop pseudo-clients stored before the filter above existed, plus MAC-less
    // leftovers now superseded by a MAC-carrying row for the same IP (which is
    // what a first router-provider sync leaves behind). Only ever removes
    // unassigned rows, so nothing a parent has organised is touched.
    const all = await this.devices.find();

    // Anything the feed no longer lists has left. Without this a device that
    // simply vanishes — its address gone from both AdGuard and the router —
    // stays "online" forever with a last-seen frozen at the moment it went,
    // which is how host.docker.internal sat in the online count for a day and
    // a half. Guarded on a non-empty feed so one bad poll cannot declare the
    // whole house offline. Last-seen is deliberately untouched: it already
    // holds the last sync that really did see them.
    if (discovered.length) {
      const present = new Set(discovered.map((d) => d.ip));
      const departed = all.filter(
        (row) => row.isOnline && !present.has(row.ipAddress),
      );
      for (const row of departed) row.isOnline = false;
      if (departed.length) {
        await this.devices.save(departed);
        this.logger.log(
          `Device sync: ${departed.length} no longer present, marked offline`,
        );
      }
    }

    const ipsWithMac = new Set(
      all.filter((row) => row.macAddress).map((row) => row.ipAddress),
    );
    const stale = all.filter(
      (row) =>
        !row.profileId &&
        (isNonDeviceAddress(row.ipAddress) ||
          (!row.macAddress && ipsWithMac.has(row.ipAddress))),
    );

    // Collapse rows left behind by MAC randomization: several entries for one
    // IP where at least one MAC is randomized. Keep the row the parent has
    // invested in (profile, then a name they typed, then the oldest), fold the
    // live MAC/online state into it, and drop the rest.
    const dropped = new Set(stale.map((row) => row.id));
    const byIpGroup = new Map<string, Device[]>();
    for (const row of all) {
      if (dropped.has(row.id) || !row.ipAddress) continue;
      byIpGroup.set(row.ipAddress, [...(byIpGroup.get(row.ipAddress) ?? []), row]);
    }
    for (const [, group] of byIpGroup) {
      if (group.length < 2 || !group.some((row) => row.macRandomized)) continue;
      // Keep the row with the longest history — it holds whatever the parent
      // renamed or assigned. Picking "first row with a non-placeholder name"
      // is wrong: a router-supplied hostname is indistinguishable from a typed
      // one, so that rule can discard the parent's rename in favour of the
      // router's label.
      const keeper =
        group.find((row) => row.profileId) ??
        group.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      // Don't lose a good name that only the discarded row had.
      if (isPlaceholderName(keeper.name, keeper.ipAddress, keeper.vendor)) {
        const named = group.find(
          (row) =>
            row.id !== keeper.id &&
            !isPlaceholderName(row.name, row.ipAddress, row.vendor),
        );
        if (named) keeper.name = named.name;
      }
      const newest = group.reduce((a, b) =>
        (a.lastSeenAt?.getTime() ?? 0) >= (b.lastSeenAt?.getTime() ?? 0) ? a : b,
      );
      keeper.macAddress = newest.macAddress ?? keeper.macAddress;
      keeper.macRandomized = newest.macRandomized;
      keeper.isOnline = group.some((row) => row.isOnline);
      await this.devices.save(keeper);
      for (const row of group) {
        if (row.id !== keeper.id && !row.profileId) stale.push(row);
      }
    }
    // One row per MAC. A device that moves to a new lease is discovered at the
    // new address while its old row lingers, so the list slowly fills with the
    // same laptop at three addresses. Keeping the invested row and folding the
    // current address into it means the parent never has to Forget by hand.
    const byMac = new Map<string, Device[]>();
    for (const row of all) {
      if (dropped.has(row.id) || stale.includes(row)) continue;
      if (!row.macAddress || row.macRandomized) continue; // randomized MACs are handled above
      const key = row.macAddress.toLowerCase();
      byMac.set(key, [...(byMac.get(key) ?? []), row]);
    }
    for (const [, group] of byMac) {
      if (group.length < 2) continue;
      const keeper =
        group.find((row) => row.profileId) ??
        group.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      if (isPlaceholderName(keeper.name, keeper.ipAddress, keeper.vendor)) {
        const named = group.find(
          (row) =>
            row.id !== keeper.id &&
            !isPlaceholderName(row.name, row.ipAddress, row.vendor),
        );
        if (named) keeper.name = named.name;
      }
      // The address that is actually live wins; a stale row must not drag the
      // keeper back to an address the device no longer holds.
      const newest = group.reduce((a, b) =>
        (a.lastSeenAt?.getTime() ?? 0) >= (b.lastSeenAt?.getTime() ?? 0) ? a : b,
      );
      keeper.ipAddress = newest.ipAddress;
      keeper.isOnline = group.some((row) => row.isOnline);
      keeper.lastSeenAt = newest.lastSeenAt;
      await this.devices.save(keeper);
      for (const row of group) {
        if (row.id !== keeper.id && !row.profileId) stale.push(row);
      }
    }

    // Ghosts: an address that was seen once, never carried a MAC, was never
    // named or assigned, and has not appeared for a week. That is a lease that
    // moved on, not a device — 192.168.8.103 outliving the laptop at .100.
    const ghostCutoff = Date.now() - GHOST_DAYS * 24 * 60 * 60 * 1000;
    for (const row of all) {
      if (dropped.has(row.id) || stale.includes(row)) continue;
      if (row.profileId || row.blocked || row.macAddress) continue;
      if (!isPlaceholderName(row.name, row.ipAddress, row.vendor)) continue;
      if (row.isOnline) continue;
      if ((row.lastSeenAt?.getTime() ?? 0) >= ghostCutoff) continue;
      stale.push(row);
    }

    if (stale.length) {
      await this.devices.remove(stale);
      this.logger.log(`Device sync: pruned ${stale.length} non-device entries`);
    }

    // A moved or newly-created device changes the identifier set that blocking
    // is written against. Without this, a blocked device that picks up a new
    // lease keeps its block pinned to the old address and quietly goes free.
    if (enforcementStale || created) {
      await this.profiles.syncBlockedIdentifiers();
      this.logger.log('Device sync: re-pushed enforcement (addresses changed)');
    }

    this.logger.log(
      `Device sync: ${discovered.length} discovered, ${created} new`,
    );
    return { discovered: discovered.length, created };
  }

  /**
   * Forget a device, and make it stick.
   *
   * This used to be advisory — the next sync re-created anything still on the
   * network. Correct for a real device, useless for the entries that prompted
   * the button: a WSL vEthernet adapter reappearing after every tidy-up. A
   * tombstone suppresses re-creation until the address turns up with a DHCP
   * lease, which a virtual adapter never gets.
   */
  /**
   * Rows that look like the same physical device seen twice.
   *
   * The signal is a shared announced hostname plus a randomized MAC on at
   * least one side — which is exactly how MAC randomization manifests: same
   * device, new MAC, new lease, new row. A shared *factory code* hostname
   * ("SM-L330") is the strongest case, since that is the device naming itself
   * rather than a person naming it.
   *
   * Returned as a suggestion, never acted on. See merge() for why.
   */
  async duplicateGroups(): Promise<Array<{ key: string; deviceIds: string[] }>> {
    const all = await this.devices.find();
    const byName = new Map<string, Device[]>();
    for (const d of all) {
      const announced = (d.hostname ?? d.name ?? '').trim().toLowerCase();
      if (!announced) continue;
      byName.set(announced, [...(byName.get(announced) ?? []), d]);
    }
    const groups: Array<{ key: string; deviceIds: string[] }> = [];
    for (const [key, rows] of byName) {
      if (rows.length < 2) continue;
      // Without a randomized MAC in the mix these are simply two devices with
      // the same name, which is a labelling problem, not a duplicate.
      if (!rows.some((r) => r.macRandomized)) continue;
      // Two rows already assigned to different children are two devices as far
      // as the household is concerned; never suggest undoing that.
      const profiles = new Set(rows.map((r) => r.profileId).filter(Boolean));
      if (profiles.size > 1) continue;
      groups.push({
        key,
        deviceIds: rows
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => r.id),
      });
    }
    return groups;
  }

  /**
   * Fold one device row into another, keeping all of both devices' history.
   *
   * A phone or watch with MAC randomization presents a fresh MAC on a fresh
   * lease and arrives as a brand-new device. The existing dedupe only collapses
   * rows sharing an IP, so a device that reconnects on a different address
   * escapes it entirely — which is how one Galaxy Watch became two entries a
   * day apart.
   *
   * This is deliberately NOT automatic. Two identical tablets in one house
   * announce the same hostname and both randomize their MACs; there is no
   * signal that separates "one device twice" from "two devices". Merging them
   * silently would hand one child's controls to both. So the app points out the
   * resemblance and a parent, who knows how many watches they own, decides.
   */
  async merge(keeperId: string, absorbedId: string): Promise<Device> {
    if (keeperId === absorbedId) {
      throw new BadRequestException('A device cannot be merged into itself.');
    }
    const keeper = await this.findOne(keeperId);
    const absorbed = await this.findOne(absorbedId);

    await this.devices.manager.transaction(async (tx) => {
      // Plain repoints: nothing here can collide.
      for (const [table, col] of [
        ['activity_logs', 'deviceId'],
        ['rules', 'deviceId'],
        ['push_subscriptions', 'deviceId'],
        ['access_requests', 'deviceId'],
      ] as const) {
        await tx.query(
          `UPDATE ${table} SET "${col}" = $1 WHERE "${col}" = $2`,
          [keeper.id, absorbed.id],
        );
      }

      // Counter tables are keyed by (device, day), so the two rows for a day
      // both devices were seen must be added together, not one dropped.
      await tx.query(
        `INSERT INTO device_daily (date, "deviceId", "deviceName", "profileId", "activeMinutes", lookups, blocked)
         SELECT date, $1, "deviceName", "profileId", "activeMinutes", lookups, blocked
           FROM device_daily WHERE "deviceId" = $2
         ON CONFLICT (date, "deviceId") DO UPDATE SET
           "activeMinutes" = device_daily."activeMinutes" + EXCLUDED."activeMinutes",
           lookups         = device_daily.lookups + EXCLUDED.lookups,
           blocked         = device_daily.blocked + EXCLUDED.blocked`,
        [keeper.id, absorbed.id],
      );
      await tx.query(`DELETE FROM device_daily WHERE "deviceId" = $1`, [absorbed.id]);

      await tx.query(
        `INSERT INTO activity_rollups (date, "profileId", "deviceId", domain, action, hits)
         SELECT date, "profileId", $1, domain, action, hits
           FROM activity_rollups WHERE "deviceId" = $2
         ON CONFLICT (date, "profileId", "deviceId", domain, action) DO UPDATE SET
           hits = activity_rollups.hits + EXCLUDED.hits`,
        [keeper.id, absorbed.id],
      );
      await tx.query(`DELETE FROM activity_rollups WHERE "deviceId" = $1`, [absorbed.id]);

      await tx.query(
        `INSERT INTO device_usage ("deviceId", date, "rxBytes", "txBytes")
         SELECT $1, date, "rxBytes", "txBytes" FROM device_usage WHERE "deviceId" = $2
         ON CONFLICT ("deviceId", date) DO UPDATE SET
           "rxBytes" = device_usage."rxBytes" + EXCLUDED."rxBytes",
           "txBytes" = device_usage."txBytes" + EXCLUDED."txBytes"`,
        [keeper.id, absorbed.id],
      );
      await tx.query(`DELETE FROM device_usage WHERE "deviceId" = $1`, [absorbed.id]);

      // The keeper takes on whichever facts are live. "Newer" is by last
      // sighting: the row that was seen most recently holds the address and
      // MAC the device is actually using now.
      const absorbedIsNewer =
        (absorbed.lastSeenAt?.getTime() ?? 0) > (keeper.lastSeenAt?.getTime() ?? 0);
      if (absorbedIsNewer) {
        keeper.ipAddress = absorbed.ipAddress;
        keeper.macAddress = absorbed.macAddress;
        keeper.macRandomized = absorbed.macRandomized;
        keeper.lastSeenAt = absorbed.lastSeenAt;
        keeper.hostname = absorbed.hostname ?? keeper.hostname;
        keeper.connectionType = absorbed.connectionType ?? keeper.connectionType;
        keeper.ssid = absorbed.ssid ?? keeper.ssid;
        keeper.addressSource = absorbed.addressSource ?? keeper.addressSource;
      }
      keeper.isOnline = keeper.isOnline || absorbed.isOnline;
      keeper.vendor = keeper.vendor ?? absorbed.vendor;
      // Never lose a parent's decisions to a merge.
      keeper.profileId = keeper.profileId ?? absorbed.profileId;
      keeper.blocked = keeper.blocked || absorbed.blocked;
      if (isPlaceholderName(keeper.name, keeper.ipAddress, keeper.vendor)) {
        if (!isPlaceholderName(absorbed.name, absorbed.ipAddress, absorbed.vendor)) {
          keeper.name = absorbed.name;
        }
      }
      await tx.save(Device, keeper);
      await tx.delete(Device, { id: absorbed.id });

      // Without this the merge lasts one sync. The absorbed MAC and address
      // still hold a DHCP lease the router keeps reporting, so discovery would
      // find no device for them and create the duplicate all over again.
      for (const key of this.tombstoneKeys(absorbed.ipAddress, absorbed.macAddress)) {
        await tx.query(
          `INSERT INTO device_aliases (key, "deviceId", name) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET "deviceId" = EXCLUDED."deviceId"`,
          [key, keeper.id, absorbed.name],
        );
      }
      // The keeper's own current identity must not be an alias of itself.
      await tx.query(`DELETE FROM device_aliases WHERE key = ANY($1)`, [
        this.tombstoneKeys(keeper.ipAddress, keeper.macAddress),
      ]);
    });

    this.logger.log(
      `Merged "${absorbed.name}" (${absorbed.ipAddress}) into "${keeper.name}" (${keeper.ipAddress})`,
    );
    // The absorbed row's identifiers were part of enforcement; re-push.
    await this.profiles.syncBlockedIdentifiers();
    if (keeper.profileId) await this.profiles.syncProfile(keeper.profileId);
    return this.findOne(keeper.id);
  }

  async remove(id: string): Promise<void> {
    const device = await this.findOne(id);
    const profileId = device.profileId;
    await this.devices.remove(device);

    const keys = this.tombstoneKeys(device.ipAddress, device.macAddress);
    for (const key of keys) {
      await this.forgotten
        .createQueryBuilder()
        .insert()
        .values({ key, name: device.name })
        .orIgnore() // forgetting the same thing twice is not an error
        .execute();
    }
    this.logger.log(`Forgot "${device.name}" (${keys.join(', ')})`);

    // Its identifiers were part of the profile's appliance policy — re-push.
    if (profileId) await this.profiles.syncProfile(profileId);
  }

  private tombstoneKeys(ip: string | null, mac: string | null): string[] {
    const keys: string[] = [];
    if (mac) keys.push(`mac:${mac.toLowerCase()}`);
    if (ip) keys.push(`ip:${ip.toLowerCase()}`);
    return keys;
  }

  /** The surviving device an old MAC/address was merged into, if any. */
  private async resolveAlias(
    ip: string | null,
    mac: string | null,
  ): Promise<Device | null> {
    const keys = this.tombstoneKeys(ip, mac);
    if (!keys.length) return null;
    // MAC first: it is the identity, the address is only where it was.
    for (const key of keys) {
      const hit = await this.aliases.findOne({ where: { key } });
      if (!hit) continue;
      const device = await this.devices.findOne({ where: { id: hit.deviceId } });
      if (device) return device;
      // The device it pointed at is gone; the alias is now noise.
      await this.aliases.delete({ key });
    }
    return null;
  }

  private async isForgotten(ip: string | null, mac: string | null): Promise<boolean> {
    const keys = this.tombstoneKeys(ip, mac);
    if (!keys.length) return false;
    return (await this.forgotten.countBy(keys.map((key) => ({ key })))) > 0;
  }

  private async clearTombstones(ip: string | null, mac: string | null): Promise<void> {
    const keys = this.tombstoneKeys(ip, mac);
    if (keys.length) await this.forgotten.delete(keys.map((key) => ({ key })));
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<Device> {
    const device = await this.findOne(id);
    const profileChanged =
      dto.profileId !== undefined && dto.profileId !== device.profileId;

    Object.assign(device, dto);
    const saved = await this.devices.save(device);

    // Re-push affected profile policies so the appliance matches the new grouping.
    if (profileChanged) {
      if (device.profileId) await this.profiles.syncProfile(device.profileId);
      if (dto.profileId) await this.profiles.syncProfile(dto.profileId);
    }
    if (dto.blocked !== undefined) {
      await this.profiles.syncBlockedIdentifiers();
    } else if (device.profileId) {
      await this.profiles.syncProfile(device.profileId);
    }
    return saved;
  }
}
