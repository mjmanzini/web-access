import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityRollup } from '../entities/activity-rollup.entity';
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
export class ActivityService implements OnModuleInit {
  private readonly logger = new Logger(ActivityService.name);
  private watermark = new Date(0);

  /**
   * Recover the watermark from the database on boot.
   *
   * It used to live only in memory, so every restart reset it to the epoch and
   * the next poll re-ingested up to 500 rows it already held. Measured on this
   * install after a day of deploys: 53% of activity_logs were duplicates, one
   * event stored thirty times. That is not only wasted disk — it doubled every
   * "queries today" figure the dashboard reported.
   */
  async onModuleInit(): Promise<void> {
    const newest = await this.logs
      .createQueryBuilder('a')
      .select('MAX(a.timestamp)', 'max')
      .getRawOne<{ max: Date | null }>();
    if (newest?.max) {
      this.watermark = new Date(newest.max);
      this.logger.log(`Ingest watermark restored to ${this.watermark.toISOString()}`);
    }
  }

  constructor(
    @InjectRepository(ActivityLog) private logs: Repository<ActivityLog>,
    @InjectRepository(ActivityRollup) private rollups: Repository<ActivityRollup>,
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
      // Belt to the watermark's braces: a unique index over the natural key
      // means a re-read of the same window is a no-op rather than a second
      // copy. `orIgnore` reports zero identifiers when the row already
      // existed, which is also how we avoid re-alerting on old events.
      const result = await this.logs
        .createQueryBuilder()
        .insert()
        .values(row)
        .orIgnore()
        .execute();
      if (!result.identifiers?.[0]) continue;
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
      // Not every DoH/DoT lookup is a child evading anything:
      //
      //  - Android probes dns.google constantly for its Private DNS feature,
      //    and Firefox queries the canary domain on every start. Those are OS
      //    behaviour, and alerting on them trains a parent to ignore alerts.
      //  - If our anti-bypass rules already blocked it, containment worked —
      //    that is a success, not an incident.
      //  - On a device that belongs to no profile (a parent's own phone) there
      //    is nothing to evade in the first place.
      //
      // What is worth interrupting someone for: a *managed* device that
      // successfully reached a private resolver, i.e. it now has a way to
      // resolve around us.
      const isCanary = row.domain === FIREFOX_DOH_CANARY;
      const wasContained = row.action === 'blocked';
      const isManaged = !!device?.profileId;
      if (isCanary || wasContained || !isManaged) return;

      this.events.emitAlert({
        type: 'bypass_attempt',
        severity: 'warning',
        message:
          `${device?.name ?? row.clientIp} reached a private DNS resolver (${row.domain}) that was NOT blocked — ` +
          `it may be able to resolve around Home Guardian. Check the device's Private DNS setting.`,
        deviceId: device?.id ?? null,
        profileId: device?.profileId ?? null,
        domain: row.domain,
        at: row.timestamp.toISOString(),
      });
      return;
    }

    // A blocked query is not an event worth announcing — it is the system
    // doing its job, hundreds of times an hour, and during bedtime it is
    // EVERY query. Alerting on it buried the alerts that matter and made the
    // feed unreadable. This data already lives in Activity, which is filterable
    // per device and is the right place to look at it.
    //
    // Deliberately no emitAlert here.
  }

  // ---- read APIs for the dashboard ----

  /**
   * Recent activity, newest first, with each row's device name attached so the
   * dashboard can show "Jastice's phone" instead of a bare 192.168.8.60. Rows
   * are denormalized by design, so the name is resolved at read time rather
   * than stored — a rename is reflected across all history immediately.
   */
  async recent(
    limit = 100,
    deviceId?: string,
  ): Promise<Array<ActivityLog & { deviceName: string | null }>> {
    // Rows keep the deviceId they were ingested with, which goes stale when a
    // device row is replaced (a re-scan that supersedes a MAC-less entry, say).
    // Match on the stored id OR the client IP so a device's history stays whole
    // instead of splitting into "before" and "after" halves.
    const target = deviceId
      ? await this.devices.findOne({ where: { id: deviceId } })
      : null;

    // Filtering server-side matters: a chatty phone can fill the whole window,
    // so a client-side filter would show "no activity" for quieter devices.
    const rows = await this.logs.find({
      where: deviceId
        ? target?.ipAddress
          ? [{ deviceId }, { clientIp: target.ipAddress }]
          : { deviceId }
        : {},
      order: { timestamp: 'DESC' },
      take: limit,
    });

    // Resolve names by id first, then by current IP holder — the latter rescues
    // rows whose device row no longer exists.
    const devices = await this.devices.find();
    const byId = new Map(devices.map((d) => [d.id, d]));
    const byIp = new Map(devices.filter((d) => d.ipAddress).map((d) => [d.ipAddress, d]));

    return rows.map((r) => {
      const device = (r.deviceId ? byId.get(r.deviceId) : null) ?? byIp.get(r.clientIp);
      return {
        ...r,
        // Report the *current* device id so the dashboard groups history under
        // one entry per device rather than one per superseded row.
        deviceId: device?.id ?? r.deviceId,
        deviceName: device?.name ?? null,
      };
    });
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

  /**
   * Historical top domains from the kept rollups (survives raw-log pruning).
   * `days` counts back from today; omit profileId for all traffic.
   */
  async history(params: {
    profileId?: string;
    days?: number;
    limit?: number;
  }): Promise<Array<{ domain: string; hits: number }>> {
    const since = new Date(Date.now() - (params.days ?? 30) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const qb = this.rollups
      .createQueryBuilder('r')
      .select('r.domain', 'domain')
      .addSelect('SUM(r.hits)', 'hits')
      .where('r.date >= :since', { since })
      .groupBy('r.domain')
      .orderBy('hits', 'DESC')
      .limit(params.limit ?? 20);
    if (params.profileId) qb.andWhere('r.profileId = :p', { p: params.profileId });
    const rows = await qb.getRawMany();
    return rows.map((r) => ({ domain: r.domain, hits: Number(r.hits) }));
  }

  /** Count distinct 5-minute active buckets today → an "active minutes" proxy. */
  /**
   * How many blocked lookups these devices made since a moment. Used to tell a
   * device that has quietly given up from one still hammering at the block.
   */
  async blockedCountSince(deviceIds: string[], since: Date): Promise<number> {
    if (!deviceIds.length) return 0;
    return this.logs
      .createQueryBuilder('a')
      .where('a.deviceId IN (:...ids)', { ids: deviceIds })
      .andWhere('a.timestamp >= :since', { since })
      .andWhere("a.action = 'blocked'")
      .getCount();
  }

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
