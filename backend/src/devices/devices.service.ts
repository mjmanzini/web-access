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

  findAll(): Promise<Device[]> {
    return this.devices.find({
      relations: { profile: true },
      order: { lastSeenAt: 'DESC' },
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
    const discovered = await this.network.discoverDevices();

    // Merge router DHCP leases (MAC-authoritative) — enrich MACs on devices
    // AdGuard saw by IP only, and add any the router sees that AdGuard didn't.
    if (this.router.isEnabled()) {
      const byIp = new Map(discovered.map((d) => [d.ip, d]));
      for (const lease of await this.router.listLeases()) {
        const existing = byIp.get(lease.ip);
        if (existing) {
          existing.mac = existing.mac ?? lease.mac;
          existing.name = existing.name ?? lease.hostname;
        } else {
          const d = {
            ip: lease.ip,
            mac: lease.mac,
            name: lease.hostname,
            online: true,
            lastSeen: new Date(),
          };
          discovered.push(d);
          byIp.set(lease.ip, d);
        }
      }
    }

    let created = 0;

    for (const d of discovered) {
      const mac = normalizeMac(d.mac);
      // Match on MAC first (stable), else on IP.
      const existing = mac
        ? await this.devices.findOne({ where: { macAddress: mac } })
        : await this.devices.findOne({ where: { ipAddress: d.ip } });

      if (existing) {
        existing.ipAddress = d.ip || existing.ipAddress;
        existing.isOnline = d.online;
        existing.lastSeenAt = d.lastSeen ?? new Date();
        if (mac) {
          existing.macAddress = mac;
          existing.macRandomized = isRandomizedMac(mac);
        }
        await this.devices.save(existing);
        continue;
      }

      const randomized = isRandomizedMac(mac);
      const device = this.devices.create({
        name: d.name || d.ip,
        clientId: generateClientId(d.name || d.ip),
        ipAddress: d.ip,
        macAddress: mac,
        macRandomized: randomized,
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

    this.logger.log(
      `Device sync: ${discovered.length} discovered, ${created} new`,
    );
    return { discovered: discovered.length, created };
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
