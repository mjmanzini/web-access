import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from '../entities/push-subscription.entity';

/**
 * What the service worker is asked to show. The presentation knobs live here
 * rather than being guessed in the worker, so a caller can say "this one has to
 * be noticed" without the worker needing to know why.
 */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Stay on screen until tapped, rather than fading after a few seconds. */
  requireInteraction?: boolean;
  /** Vibration pattern in ms; [] means silent-ish. */
  vibrate?: number[];
  /** Ask the push service to wake the device promptly. */
  urgent?: boolean;
  ttlSeconds?: number;
}

/**
 * Web Push delivery to the installed dashboard.
 *
 * Runs alongside the Discord webhook rather than replacing it: Discord is the
 * durable log, push is the interruption. Both are fed from the same alert
 * pipeline and therefore inherit the same noise controls — the filtering that
 * keeps blocked-query spam off a phone happens upstream in EventsGateway.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subs: Repository<PushSubscription>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY', '').trim();
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY', '').trim();
    const subject = this.config.get<string>('VAPID_SUBJECT', 'mailto:admin@example.com').trim();

    if (!publicKey || !privateKey) {
      this.logger.log('push disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable');
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('push enabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** The key the browser needs to subscribe. Public by design. */
  publicKey(): string | null {
    return this.config.get<string>('VAPID_PUBLIC_KEY', '').trim() || null;
  }

  async subscribe(sub: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }): Promise<void> {
    const existing = await this.subs.findOne({ where: { endpoint: sub.endpoint } });
    if (existing) {
      // Browsers re-subscribe periodically with fresh keys for the same
      // endpoint; update rather than accumulate duplicates.
      existing.p256dh = sub.keys.p256dh;
      existing.auth = sub.keys.auth;
      existing.failures = 0;
      await this.subs.save(existing);
      return;
    }
    await this.subs.save(
      this.subs.create({
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: sub.userAgent ?? null,
        failures: 0,
      }),
    );
    this.logger.log('new push subscription registered');
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.subs.delete({ endpoint });
  }

  async count(): Promise<number> {
    return this.subs.count();
  }

  /**
   * Fan a notification out to every subscribed device. Never throws: a dead
   * endpoint must not break the alert path that triggered it.
   */
  async send(payload: PushPayload): Promise<number> {
    // Parent broadcast: device-scoped rows are excluded, so a child's tablet
    // never receives household alerts ("bypass attempt on X", "new device
    // joined") — only messages addressed to it by sendToDevices().
    return this.deliver(await this.subs.find({ where: { deviceId: IsNull() } }), payload);
  }

  /** Register a subscription that belongs to one child device. */
  async subscribeDevice(
    deviceId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ): Promise<void> {
    const existing = await this.subs.findOne({ where: { endpoint: sub.endpoint } });
    if (existing) {
      existing.p256dh = sub.keys.p256dh;
      existing.auth = sub.keys.auth;
      existing.deviceId = deviceId;
      existing.failures = 0;
      await this.subs.save(existing);
      return;
    }
    await this.subs.save(
      this.subs.create({
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        deviceId,
        userAgent: sub.userAgent ?? null,
        failures: 0,
      }),
    );
    this.logger.log('new kid-device push subscription registered');
  }

  /** Notify specific child devices — nobody else. */
  async sendToDevices(
    deviceIds: string[],
    payload: PushPayload,
  ): Promise<number> {
    if (!deviceIds.length) return 0;
    return this.deliver(await this.subs.find({ where: { deviceId: In(deviceIds) } }), payload);
  }

  /**
   * The one notification bedtime is allowed to be loud about.
   *
   * Split out from the general `sendToDevices()` so the wording, the urgency
   * and — most importantly — the landing page are decided in exactly one
   * place. Every other kid notification opens `/status`; this one opens
   * bedside mode, because the point of tapping it is to put the tablet down
   * showing a clock, not to read an explanation.
   *
   * `requireInteraction` is as close as the web platform gets to "cannot be
   * swiped away": it stops the notification auto-dismissing after a few
   * seconds, so it sits over YouTube until it is dealt with. A determined
   * child can still swipe it off — no web API can prevent that, and the
   * enforcement that actually stops the internet does not depend on this
   * message being seen.
   */
  async sendBedtimeNotification(
    deviceIds: string[],
    opts: { name?: string | null; until?: string | null } = {},
  ): Promise<number> {
    const who = (opts.name ?? '').trim();
    return this.sendToDevices(deviceIds, {
      title: who ? `Bedtime, ${who}! 🌙` : 'Bedtime! 🌙',
      // The end time rides along because it is the one fact that turns this
      // from an order into an arrangement — "back on at 06:30" is the
      // difference between a child waiting and a child arguing.
      body: opts.until ? `Time to sleep 😴 — back on at ${opts.until}.` : 'Time to sleep 😴',
      // ?from=push tells bedside mode it was launched by this tap, so it opens
      // straight into the sleep screen instead of the Start prompt.
      url: '/bedside?from=push',
      // Same tag as the other state messages: "internet is back on" should
      // replace this one in the shade, not stack underneath it.
      tag: 'kids-state',
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      urgent: true,
    });
  }

  /** How many child devices have notifications switched on. */
  async countForDevice(deviceId: string): Promise<number> {
    return this.subs.count({ where: { deviceId } });
  }

  private async deliver(
    all: PushSubscription[],
    payload: PushPayload,
  ): Promise<number> {
    if (!this.enabled) return 0;
    let delivered = 0;

    for (const sub of all) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          {
            // "The internet just stopped" is worth waking the radio for; the
            // same message ten minutes late explains nothing.
            urgency: payload.urgent ? 'high' : 'normal',
            // And there is no point delivering a bedtime notice an hour on.
            TTL: payload.ttlSeconds ?? 600,
          },
        );
        delivered++;
        if (sub.failures) await this.subs.update(sub.id, { failures: 0 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away — retire it
        // immediately rather than retrying forever.
        if (status === 404 || status === 410) {
          await this.subs.delete(sub.id);
          this.logger.log('retired an expired push subscription');
          continue;
        }
        const failures = sub.failures + 1;
        await this.subs.update(sub.id, { failures });
        if (failures >= 5) {
          await this.subs.delete(sub.id);
          this.logger.warn('retired a push subscription after 5 consecutive failures');
        } else {
          this.logger.warn(`push send failed (${status ?? 'no status'})`);
        }
      }
    }
    // So "did it actually arrive?" is answerable from the log tomorrow morning
    // rather than from memory.
    if (all.length) {
      this.logger.log(
        `push "${payload.tag ?? payload.title}" → ${delivered}/${all.length} delivered`,
      );
    }
    return delivered;
  }
}
