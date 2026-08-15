import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { Schedule } from '../entities/schedule.entity';
import { effectiveState } from '../common/effective-state';
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
      const used = await this.activity.activeMinutesToday(profile.id);
      const bonus = await this.recordUsage(profile.id, used);

      const active = (profile.schedules ?? []).find((s) =>
        SchedulesService.isActive(s, now),
      );

      // One decision, from the two switches plus the automatic conditions.
      // No special-casing here: the switches are the inputs, internetPaused /
      // pausedReason are simply the computed output, recomputed every minute.
      const state = effectiveState({
        internetSwitch: profile.internetSwitch ?? 'auto',
        bedtimeEnabled: profile.bedtimeEnabled ?? true,
        inBedtimeWindow: !!active,
        bedtimeEndsAt: active?.endTime ?? null,
        dailyLimitMinutes: profile.dailyTimeLimitMinutes,
        usedMinutes: used,
        bonusMinutes: bonus,
      });

      const reason = state.cause === 'quota' ? 'quota_exceeded' : state.cause ?? undefined;
      const changed =
        state.blocked !== profile.internetPaused ||
        (state.blocked && reason !== profile.pausedReason);

      if (changed) {
        await this.profilesService.applyEffectiveState(profile.id, state.blocked, reason);
        this.logger.log(`"${profile.name}" → ${state.summary}`);
      }
    }

    // Reconcile every tick, not just on change. The database is the source of
    // truth for who is blocked; AdGuard is a cache of that decision, and a cache
    // can drift (a lost write, a manual edit, an AdGuard restart). Pushing only
    // on change meant any drift persisted until the next state change — which,
    // for a profile that is simply switched off, is never. The push is a no-op
    // when the rules already match.
    try {
      await this.profilesService.syncBlockedIdentifiers();
    } catch (e) {
      this.logger.warn(`enforcement reconcile failed: ${(e as Error).message}`);
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
