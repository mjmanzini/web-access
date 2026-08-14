import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { Schedule } from '../entities/schedule.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { DevicesService } from '../devices/devices.service';
import { ActivityService } from '../activity/activity.service';
import { SchedulesService } from './schedules.service';

/**
 * The enforcement heartbeat. Three timers:
 *  - every 30s: poll the query log (activity + alerts)
 *  - every 2m:  re-discover devices
 *  - every 1m:  evaluate bedtime windows + daily quotas and pause/resume
 *               profiles accordingly (manual pauses always win).
 *
 * All effects flow through ProfilesService so the network layer stays the single
 * enforcement point.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(DailyUsage) private usage: Repository<DailyUsage>,
    private profilesService: ProfilesService,
    private devices: DevicesService,
    private activity: ActivityService,
  ) {}

  @Interval(30_000)
  async pollActivity(): Promise<void> {
    try {
      await this.activity.ingest();
    } catch (e) {
      this.logger.warn(`activity poll failed: ${(e as Error).message}`);
    }
  }

  @Interval(120_000)
  async discoverDevices(): Promise<void> {
    try {
      await this.devices.syncFromNetwork();
    } catch (e) {
      this.logger.warn(`device sync failed: ${(e as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async enforce(): Promise<void> {
    const now = new Date();
    const profiles = await this.profiles.find({
      relations: { schedules: true, devices: true },
    });

    for (const profile of profiles) {
      // Manual pause is sticky — automation never overrides a human decision.
      if (profile.internetPaused && profile.pausedReason === 'manual') continue;

      const used = await this.activity.activeMinutesToday(profile.id);
      const bonus = await this.recordUsage(profile.id, used);

      const overQuota =
        profile.dailyTimeLimitMinutes != null &&
        used >= profile.dailyTimeLimitMinutes + bonus;
      const inBlockWindow = (profile.schedules ?? []).some((s) =>
        SchedulesService.isActive(s, now),
      );

      const shouldPause = overQuota || inBlockWindow;
      const reason = overQuota ? 'quota_exceeded' : inBlockWindow ? 'bedtime' : undefined;

      if (shouldPause !== profile.internetPaused) {
        await this.profilesService.setPaused(profile.id, {
          paused: shouldPause,
          reason,
        });
        this.logger.log(
          `${shouldPause ? 'Paused' : 'Resumed'} "${profile.name}"` +
            (reason ? ` (${reason})` : ''),
        );
      }
    }
  }

  /** Upsert today's accrued active minutes; returns today's bonus minutes. */
  private async recordUsage(profileId: string, usedMinutes: number): Promise<number> {
    const date = new Date().toISOString().slice(0, 10);
    const existing = await this.usage.findOne({ where: { profileId, date } });
    if (existing) {
      existing.usedMinutes = usedMinutes;
      await this.usage.save(existing);
      return existing.bonusMinutes ?? 0;
    }
    await this.usage.save(this.usage.create({ profileId, date, usedMinutes }));
    return 0;
  }
}
