import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from '../entities/push-subscription.entity';

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
  async send(payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
    if (!this.enabled) return 0;
    const all = await this.subs.find();
    let delivered = 0;

    for (const sub of all) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
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
    return delivered;
  }
}
