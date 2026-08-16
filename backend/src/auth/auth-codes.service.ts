import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AuthCode, AuthCodePurpose } from '../entities/auth-code.entity';
import { RateLimiter } from '../common/rate-limit.util';

/** Six digits is the familiar shape; the limits below are what make it safe. */
const CODE_DIGITS = 6;
const CODE_TTL_MS = 10 * 60_000;
/** Wrong guesses before the code is burnt, not just rejected. */
const MAX_ATTEMPTS = 5;

/**
 * Numeric codes emailed to a parent, for password reset today and a login
 * second factor whenever that is wanted.
 *
 * A 6-digit code is one in a million per guess, which is only safe because of
 * what surrounds it: a 10-minute life, single use, five wrong guesses and the
 * code is destroyed, and rate limits on both issuing and verifying — per
 * account AND per source address, so neither a targeted nor a spray attack gets
 * many bites. The code is stored only as a SHA-256 hash.
 */
@Injectable()
export class AuthCodesService {
  private readonly logger = new Logger(AuthCodesService.name);

  /** Issuing: stops an inbox being used as a weapon against a household. */
  private static readonly issuePerAccount = new RateLimiter(3, 15 * 60_000);
  private static readonly issuePerIp = new RateLimiter(10, 60 * 60_000);
  /** Verifying: the real brute-force ceiling, independent of any one code. */
  private static readonly verifyPerIp = new RateLimiter(20, 15 * 60_000);

  constructor(
    @InjectRepository(AuthCode) private readonly codes: Repository<AuthCode>,
  ) {}

  /**
   * Issue a code, or decline quietly.
   *
   * Returns null when rate-limited. The caller must answer the user identically
   * either way — telling someone "too many requests for that address" confirms
   * the address exists.
   */
  async issue(
    userId: string,
    purpose: AuthCodePurpose,
    ip: string | null,
  ): Promise<string | null> {
    if (!AuthCodesService.issuePerAccount.allow(`${purpose}:${userId}`)) {
      this.logger.warn(`code request rate-limited for account ${userId.slice(0, 8)}`);
      return null;
    }
    if (ip && !AuthCodesService.issuePerIp.allow(ip)) {
      this.logger.warn(`code request rate-limited for ${ip}`);
      return null;
    }

    // Any earlier code for this purpose stops working — asking for a new code
    // must not leave two valid ones in circulation.
    await this.codes.update(
      { userId, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    const code = randomDigits(CODE_DIGITS);
    await this.codes.save(
      this.codes.create({
        userId,
        purpose,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        requestIp: ip,
        attempts: 0,
      }),
    );
    await this.prune();
    return code;
  }

  /**
   * Check a code. Throws a deliberately vague error on any failure — wrong,
   * expired, already used and never issued must be indistinguishable.
   */
  async consume(
    userId: string,
    purpose: AuthCodePurpose,
    code: string,
    ip: string | null,
  ): Promise<void> {
    const invalid = new BadRequestException('That code is not valid. Ask for a new one.');
    if (ip && !AuthCodesService.verifyPerIp.allow(ip)) throw invalid;

    const row = await this.codes.findOne({
      where: { userId, purpose, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!row || row.expiresAt < new Date()) throw invalid;

    if (!constantTimeEqual(sha256((code ?? '').trim()), row.codeHash)) {
      row.attempts += 1;
      // Burn it rather than letting an attacker keep the same target alive.
      if (row.attempts >= MAX_ATTEMPTS) {
        row.consumedAt = new Date();
        this.logger.warn(`code burnt after ${MAX_ATTEMPTS} wrong attempts`);
      }
      await this.codes.save(row);
      throw invalid;
    }

    row.consumedAt = new Date();
    await this.codes.save(row);
  }

  /** Expired and spent rows are noise; keep the table small. */
  private async prune(): Promise<void> {
    await this.codes.delete({ expiresAt: LessThan(new Date(Date.now() - 24 * 3600_000)) });
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Uniform over the full range — no modulo bias, no predictable prefixes. */
function randomDigits(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += randomInt(0, 10).toString();
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
