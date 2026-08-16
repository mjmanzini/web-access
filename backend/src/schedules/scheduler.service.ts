import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { PushService } from '../push/push.service';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from '../network/network-provider.interface';

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
/** How long before bedtime the child is warned. */
const WARN_MINUTES = 10;

/** How long into a block before one follow-up notification, if still needed. */
const NAG_AFTER_MS = 5 * 60_000;

/** Blocked lookups in that window that count as "still trying", not noise. */
const NAG_MIN_BLOCKED = 5;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(DailyUsage) private usage: Repository<DailyUsage>,
    private profilesService: ProfilesService,
    private devices: DevicesService,
    private activity: ActivityService,
    private push: PushService,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
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

    await this.nagStillTrying(profiles);

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

  /** Fired for a given occurrence already, so nobody is warned twice. */
  private warned = new Set<string>();

  /** When each profile's current block started, and whether we have nagged. */
  private blockedSince = new Map<string, { at: number; nagged: boolean }>();

  /**
   * One follow-up, and only when it is warranted.
   *
   * The first notification can be missed — the tablet is face-down, the child
   * is mid-video, the screen is off. What tells us it was missed is the device
   * still hammering away: apps retrying, queries piling up against the block.
   * If that is still happening five minutes in, say it once more. Once. A
   * second nag would just teach everyone to swipe these away.
   */
  private async nagStillTrying(profiles: Profile[]): Promise<void> {
    const now = Date.now();

    for (const profile of profiles) {
      if (!profile.internetPaused) {
        this.blockedSince.delete(profile.id);
        continue;
      }
      const state = this.blockedSince.get(profile.id);
      if (!state) {
        this.blockedSince.set(profile.id, { at: now, nagged: false });
        continue;
      }
      if (state.nagged || now - state.at < NAG_AFTER_MS) continue;

      const deviceIds = (profile.devices ?? []).map((d) => d.id);
      if (!deviceIds.length) continue;

      // Still generating blocked traffic? Then the message did not land.
      const since = new Date(now - NAG_AFTER_MS);
      const stillTrying = await this.activity.blockedCountSince(deviceIds, since);
      state.nagged = true; // one attempt either way — never re-evaluated
      if (stillTrying < NAG_MIN_BLOCKED) continue;

      try {
        const sent = await this.push.sendToDevices(deviceIds, {
          title: 'Internet is still off',
          body: 'Apps will keep failing until it comes back. Tap to see when.',
          url: '/status',
          tag: 'kids-state',
          requireInteraction: true,
          vibrate: [300, 120, 300, 120, 300],
          urgent: true,
        });
        this.logger.log(
          `"${profile.name}" still generating blocked traffic (${stillTrying}) — nagged ${sent} device(s)`,
        );
      } catch (e) {
        this.logger.warn(`nag failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * "Bedtime in 10 minutes."
   *
   * This runs on its own timer rather than inside the enforce loop for one
   * reason: it has to reach the device BEFORE the block starts. Once bedtime
   * begins, the device's DNS is answering 0.0.0.0 for everything, and while the
   * push endpoints stay allowlisted, a warning that depends on the network
   * surviving the very event it is warning about is a bad design. Ten minutes
   * of slack means the notification is long delivered by then.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async bedtimeWarnings(): Promise<void> {
    const profiles = await this.profiles.find({
      relations: { schedules: true, devices: true },
    });
    const now = new Date();
    // Devices inside the run-up window, recomputed from scratch each tick so
    // the set clears itself the moment bedtime starts or the window moves.
    const preBedtime: string[] = [];

    for (const profile of profiles) {
      if (profile.bedtimeEnabled === false) continue;
      if (profile.internetSwitch === 'off') continue; // already off; nothing to warn about
      const deviceIds = (profile.devices ?? []).map((d) => d.id);
      if (!deviceIds.length) continue;

      for (const s of profile.schedules ?? []) {
        if (!s.enabled) continue;
        const mins = SchedulesService.minutesUntilStart(s, now);
        if (mins === null || mins > WARN_MINUTES || mins <= 0) continue;

        // Inside the run-up: stop new video starting, so nothing is mid-stream
        // when the block lands and buffers drain instead of refilling.
        for (const d of profile.devices ?? []) {
          if (d.clientId) preBedtime.push(d.clientId);
          if (d.ipAddress) preBedtime.push(d.ipAddress);
        }

        const key = `${s.id}:${now.toISOString().slice(0, 10)}:${s.startTime}`;
        if (this.warned.has(key)) continue;
        this.warned.add(key);

        try {
          const sent = await this.push.sendToDevices(deviceIds, {
            title: `Bedtime in ${mins} minute${mins === 1 ? '' : 's'}`,
            body: `The internet switches off at ${s.startTime} until ${s.endTime}. Good time to finish up.`,
            url: '/status',
            tag: 'bedtime-warning',
          });
          this.logger.log(`bedtime warning for "${profile.name}" → ${sent} device(s)`);
        } catch (e) {
          this.logger.warn(`bedtime warning failed: ${(e as Error).message}`);
        }
      }
    }

    // Idempotent, and self-clearing: an empty set drops the bucket entirely.
    try {
      await this.network.setPreBedtimeIdentifiers(preBedtime);
    } catch (e) {
      this.logger.warn(`pre-bedtime tightening failed: ${(e as Error).message}`);
    }

    // Keep the dedupe set from growing forever; yesterday's keys can never
    // match again.
    if (this.warned.size > 200) {
      const today = now.toISOString().slice(0, 10);
      for (const k of this.warned) if (!k.includes(today)) this.warned.delete(k);
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
