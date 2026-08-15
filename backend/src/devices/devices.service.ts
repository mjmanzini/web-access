import {
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
import { lookupVendor } from '../common/oui';
import {
  isNonDeviceAddress,
  isPlaceholderName,
  resolveHostname,
} from '../common/hostname.util';
import { UpdateDeviceDto } from './dto/device.dto';

/**
 * Owns the device inventory. `syncFromNetwork()` is the reconciliation entry
 * point: it pulls what the appliance sees, upserts each device, flags MAC
 * randomization, and raises alerts for brand-new / evasive devices. Called on a
 * schedule (SchedulerService) and on-demand from the controller.
 */
@Injectable()
export class DevicesService implements OnModuleInit {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(ActivityLog) private activity: Repository<ActivityLog>,
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
    Array<Device & { lastFilteredAt: string | null; usingFilter: boolean }>
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
      return Object.assign(d, {
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
        } else {
          const d = {
            ip: lease.ip,
            mac: lease.mac,
            name: lease.hostname,
            // The router feed includes devices that are switched off; recording
            // them as online would make the dashboard claim the whole house is
            // always connected.
            online: lease.online ?? true,
            lastSeen: new Date(),
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
        existing.lastSeenAt = d.lastSeen ?? new Date();
        if (mac) {
          existing.macAddress = mac;
          existing.macRandomized = isRandomizedMac(mac);
          if (!existing.vendor) existing.vendor = lookupVendor(mac);
        }
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
        lastSeenAt: d.lastSeen ?? new Date(),
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

  /** Forget a device row; re-created by discovery if it is still active. */
  async remove(id: string): Promise<void> {
    const device = await this.findOne(id);
    const profileId = device.profileId;
    await this.devices.remove(device);
    // Its identifiers were part of the profile's appliance policy — re-push.
    if (profileId) await this.profiles.syncProfile(profileId);
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
