import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { Device } from '../entities/device.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { ActivityService } from '../activity/activity.service';

/**
 * What one device did, as far as we can actually tell.
 *
 * Deliberately NOT bytes. A DNS filter sees which names a device looked up,
 * never how much it then downloaded — a four-hour film and a single search can
 * be one lookup each. This router has no per-host counters either (its API
 * exposes only whole-WAN totals), so any megabyte figure here would be
 * invented. Minutes and lookups are measured; that is what is reported.
 */
export interface DeviceActivity {
  deviceId: string;
  name: string;
  isOnline: boolean;
  /** Distinct 5-minute buckets in which this device asked us anything. */
  activeMinutesToday: number;
  activeMinutesWeek: number;
  lookupsToday: number;
  lookupsWeek: number;
  blockedToday: number;
  topDomain: string | null;
}

export interface ProfileReport {
  profileId: string;
  name: string;
  today: { usedMinutes: number; limitMinutes: number | null; bonusMinutes: number };
  last7Days: Array<{ date: string; usedMinutes: number }>;
  topDomains: Array<{ domain: string; hits: number }>;
  /** Per-device breakdown, so a parent can see WHICH device is doing it. */
  devices: DeviceActivity[];
  deviceTotals: { activeMinutesToday: number; lookupsToday: number; blockedToday: number };
}

/**
 * Read-only per-profile screen-time + activity report, assembled from
 * DailyUsage (minutes) and the kept ActivityRollup history (top domains). Powers
 * both the dashboard report view and the weekly digest.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(DailyUsage) private usage: Repository<DailyUsage>,
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(ActivityLog) private logs: Repository<ActivityLog>,
    private activity: ActivityService,
  ) {}

  async forProfile(id: string): Promise<ProfileReport> {
    const profile = await this.profiles.findOneOrFail({ where: { id } });
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

    const rows = await this.usage.find({
      where: { profileId: id, date: MoreThanOrEqual(weekAgo) },
      order: { date: 'ASC' },
    });
    const todayRow = rows.find((r) => r.date === today);
    const topDomains = await this.activity.history({ profileId: id, days: 7, limit: 10 });

    const devices = await this.deviceActivity(id);

    return {
      profileId: id,
      name: profile.name,
      devices,
      deviceTotals: {
        activeMinutesToday: devices.reduce((n, d) => n + d.activeMinutesToday, 0),
        lookupsToday: devices.reduce((n, d) => n + d.lookupsToday, 0),
        blockedToday: devices.reduce((n, d) => n + d.blockedToday, 0),
      },
      today: {
        usedMinutes: todayRow?.usedMinutes ?? 0,
        limitMinutes: profile.dailyTimeLimitMinutes,
        bonusMinutes: todayRow?.bonusMinutes ?? 0,
      },
      last7Days: rows.map((r) => ({ date: r.date, usedMinutes: r.usedMinutes })),
      topDomains,
    };
  }

  /**
   * Per-device activity for one profile's devices.
   *
   * Active minutes are counted the same way the quota is: distinct 5-minute
   * buckets in which the device asked us to resolve anything. That is a
   * "was it being used" measure, not a byte count — a device streaming for an
   * hour and a device idly checking mail can look similar in lookups, but the
   * minutes tell them apart.
   */
  private async deviceActivity(profileId: string): Promise<DeviceActivity[]> {
    const devices = await this.devices.find({ where: { profileId } });
    if (!devices.length) return [];

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(Date.now() - 6 * 86_400_000);
    weekStart.setHours(0, 0, 0, 0);

    // One pass over the week; per-device slicing happens in memory rather than
    // as N queries per device.
    const rows = await this.logs.find({
      where: { profileId, timestamp: MoreThanOrEqual(weekStart) },
      select: { deviceId: true, timestamp: true, action: true, domain: true },
    });

    return devices.map((device) => {
      const mine = rows.filter((r) => r.deviceId === device.id);
      const today = mine.filter((r) => r.timestamp >= dayStart);

      const buckets = (list: typeof mine) => {
        const set = new Set<number>();
        for (const r of list) set.add(Math.floor(r.timestamp.getTime() / 300_000));
        return set.size * 5;
      };

      const counts = new Map<string, number>();
      for (const r of mine) counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1);
      const topDomain =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        deviceId: device.id,
        name: device.name,
        isOnline: device.isOnline,
        activeMinutesToday: buckets(today),
        activeMinutesWeek: buckets(mine),
        lookupsToday: today.length,
        lookupsWeek: mine.length,
        blockedToday: today.filter((r) => r.action === 'blocked').length,
        topDomain,
      };
    });
  }

  async forAll(): Promise<ProfileReport[]> {
    const profiles = await this.profiles.find();
    return Promise.all(profiles.map((p) => this.forProfile(p.id)));
  }
}
