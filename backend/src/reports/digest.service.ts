import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportsService } from './reports.service';
import { postWebhook } from '../common/webhook.util';

/**
 * Weekly family digest. Composes a per-profile screen-time + top-domains summary
 * and posts it to ALERT_WEBHOOK_URL (Discord/Slack/ntfy) so a parent gets it on
 * their phone without opening the dashboard. No-op if no webhook is configured.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly config: ConfigService,
  ) {}

  // Sundays at 18:00 (cron runs in the server's local timezone).
  @Cron('0 18 * * 0')
  async weekly(): Promise<void> {
    await this.sendNow();
  }

  /** Build and send the digest now; returns the composed text. */
  async sendNow(): Promise<{ sent: boolean; text: string }> {
    const reports = await this.reports.forAll();
    const lines = ['🏠 *Home Guardian — weekly digest*', ''];
    for (const r of reports) {
      const total = r.last7Days.reduce((s, d) => s + d.usedMinutes, 0);
      const top = r.topDomains.slice(0, 3).map((d) => d.domain).join(', ') || '—';
      lines.push(
        `• *${r.name}*: ${Math.round(total / 60)}h this week` +
          (r.today.limitMinutes ? ` (limit ${r.today.limitMinutes}m/day)` : '') +
          ` — top: ${top}`,
      );
    }
    const text = lines.join('\n');

    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!url) {
      this.logger.debug('digest composed but no ALERT_WEBHOOK_URL set');
      return { sent: false, text };
    }
    // postWebhook handles Discord's 2000-char cap (splitting on line
    // boundaries) and its **bold** syntax; a long digest would otherwise be
    // rejected outright rather than truncated.
    const sent = await postWebhook(url, text, (m) =>
      this.logger.warn(`digest webhook failed: ${m}`),
    );
    if (sent) this.logger.log('weekly digest sent');
    return { sent, text };
  }
}
