import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { Device } from '../entities/device.entity';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from '../network/network-provider.interface';
import { EventsGateway } from '../events/events.gateway';
import { PUBLIC_DOH_HOSTS, FIREFOX_DOH_CANARY } from '../network/adguard/anti-bypass';

/**
 * Pulls the network layer's query log, maps each line to a known device/profile
 * by client IP, persists it, and raises real-time alerts for (a) blocked
 * accesses and (b) DNS-bypass attempts (queries to public DoH/DoT resolvers).
 * `ingest()` is idempotent-ish: it watermarks on the newest timestamp seen so a
 * repeated poll doesn't double-insert.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private watermark = new Date(0);

  constructor(
    @InjectRepository(ActivityLog) private logs: Repository<ActivityLog>,
    @InjectRepository(Device) private devices: Repository<Device>,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    private events: EventsGateway,
  ) {}

  /** Poll the appliance and store any entries newer than the watermark. */
  async ingest(limit = 500): Promise<{ ingested: number }> {
    const entries = await this.network.fetchQueryLog(limit);
    // Build an IP → device map once per poll.
    const deviceByIp = new Map<string, Device>();
    for (const d of await this.devices.find()) {
      if (d.ipAddress) deviceByIp.set(d.ipAddress, d);
    }

    let ingested = 0;
    let newest = this.watermark;

    // Oldest-first so alerts fire in order.
    for (const e of [...entries].reverse()) {
      if (e.timestamp <= this.watermark) continue;
      if (e.timestamp > newest) newest = e.timestamp;

      const device = deviceByIp.get(e.clientIp) ?? null;
      const row = this.logs.create({
        timestamp: e.timestamp,
        clientIp: e.clientIp,
        deviceId: device?.id ?? null,
        profileId: device?.profileId ?? null,
        domain: e.domain,
        queryType: e.queryType,
        action: e.action,
        category: e.category,
        upstream: e.upstream,
        elapsedMs: e.elapsedMs,
      });
      await this.logs.save(row);
      ingested++;

      this.raiseAlerts(row, device);
      this.events.emitActivity(row);
    }

    this.watermark = newest;
    if (ingested) this.logger.debug(`Ingested ${ingested} query-log rows`);
    return { ingested };
  }

  /** Emit alerts for blocked hits and bypass attempts. */
  private raiseAlerts(row: ActivityLog, device: Device | null): void {
    const isBypass =
      PUBLIC_DOH_HOSTS.some((h) => row.domain === h || row.domain.endsWith(`.${h}`)) ||
      row.domain === FIREFOX_DOH_CANARY;

    if (isBypass) {
      this.events.emitAlert({
        type: 'bypass_attempt',
        severity: 'critical',
        message: `${device?.name ?? row.clientIp} tried to reach a DNS-bypass resolver (${row.domain}).`,
        deviceId: device?.id ?? null,
        profileId: device?.profileId ?? null,
        domain: row.domain,
        at: row.timestamp.toISOString(),
      });
      return;
    }

    if (row.action === 'blocked') {
      this.events.emitAlert({
        type: 'blocked_access',
        severity: 'warning',
        message: `${device?.name ?? row.clientIp} was blocked from ${row.domain}.`,
        deviceId: device?.id ?? null,
        profileId: device?.profileId ?? null,
        domain: row.domain,
        at: row.timestamp.toISOString(),
      });
    }
  }

  // ---- read APIs for the dashboard ----

  recent(limit = 100): Promise<ActivityLog[]> {
    return this.logs.find({ order: { timestamp: 'DESC' }, take: limit });
  }

  /** Top domains for a device/profile over the last `hours`. */
  async topDomains(params: {
    deviceId?: string;
    profileId?: string;
    hours?: number;
    limit?: number;
  }): Promise<Array<{ domain: string; hits: number }>> {
    const since = new Date(Date.now() - (params.hours ?? 24) * 3600_000);
    const qb = this.logs
      .createQueryBuilder('a')
      .select('a.domain', 'domain')
      .addSelect('COUNT(*)', 'hits')
      .where('a.timestamp >= :since', { since })
      .groupBy('a.domain')
      .orderBy('hits', 'DESC')
      .limit(params.limit ?? 20);
    if (params.deviceId) qb.andWhere('a.deviceId = :d', { d: params.deviceId });
    if (params.profileId) qb.andWhere('a.profileId = :p', { p: params.profileId });
    const rows = await qb.getRawMany();
    return rows.map((r) => ({ domain: r.domain, hits: Number(r.hits) }));
  }

  /** Count distinct 5-minute active buckets today → an "active minutes" proxy. */
  async activeMinutesToday(profileId: string): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await this.logs.find({
      where: { profileId, timestamp: Between(start, new Date()) },
      select: { timestamp: true },
    });
    const buckets = new Set<number>();
    for (const r of rows) buckets.add(Math.floor(r.timestamp.getTime() / 300_000));
    return buckets.size * 5;
  }
}
