import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Outbound email, via Resend's HTTP API.
 *
 * No SDK: one authenticated POST is the whole integration, and a dependency
 * that ships its own HTTP stack is not worth carrying for that. Disabled
 * cleanly when RESEND_API_KEY is unset — the app must still boot and every
 * caller must still behave, because "the mailer is not configured" cannot be
 * allowed to become "the reset flow crashes".
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY', '').trim();
    this.from = config
      .get<string>('MAIL_FROM', 'Home Guardian <guardian@send.mjmanziniholdings.co.za>')
      .trim();
    this.logger.log(
      this.apiKey ? `mail enabled, sending as ${this.from}` : 'mail disabled — set RESEND_API_KEY',
    );
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Returns whether it was accepted. Never throws: a caller deciding what to
   * tell the user must not have that decision made for it by a network blip,
   * and the reset flow deliberately answers the same either way.
   */
  async send(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn(`mail not sent (no API key): "${subject}" to ${redact(to)}`);
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, text, html }),
      });
      if (!res.ok) {
        // Body may carry the reason (unverified domain, bad key); it does not
        // contain the recipient, so it is safe to log.
        const detail = await res.text().catch(() => '');
        this.logger.warn(`mail rejected (${res.status}) for ${redact(to)}: ${detail.slice(0, 200)}`);
        return false;
      }
      this.logger.log(`mail sent: "${subject}" to ${redact(to)}`);
      return true;
    } catch (err) {
      this.logger.warn(`mail failed for ${redact(to)}: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Logs should be useful without putting household addresses in a log file. */
function redact(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}
