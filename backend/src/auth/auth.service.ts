import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AdminUser } from '../entities/admin-user.entity';
import { AuthCodesService } from './auth-codes.service';
import { MailerService } from './mailer.service';
import { RateLimiter } from '../common/rate-limit.util';

/** How long an invite / reset link stays usable. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Failed logins tolerated before a pause. Generous enough that a parent
 * mistyping on a phone keyboard never notices; tight enough that guessing is
 * hopeless — five tries per quarter hour is a few hundred a day against one
 * account, versus a password space that should be astronomically larger.
 */
const LOGIN_MAX_PER_ACCOUNT = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;
/** One host trying many usernames — the spraying ceiling. */
const LOGIN_MAX_PER_IP = 30;

/**
 * A real bcrypt hash of a value nobody knows. Compared against when the
 * username does not exist, so an unknown name costs the same time as a known
 * one — otherwise response timing alone tells them apart.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO3nX8Zt0Vd1Xz2Q0kQ1e0jVQ9Xzq2W5K';

/** 429 carrying the wait, so the controller can set Retry-After. */
export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many sign-in attempts. Try again in ${Math.ceil(
          retryAfterSeconds / 60,
        )} minute(s).`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  // Static so the ceilings survive request scope; process-local by design, in
  // keeping with the rest of this app's limiters.
  private static readonly loginPerAccount = new RateLimiter(LOGIN_MAX_PER_ACCOUNT, LOGIN_WINDOW_MS);
  private static readonly loginPerIp = new RateLimiter(LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS);

  constructor(
    @InjectRepository(AdminUser) private users: Repository<AdminUser>,
    private jwt: JwtService,
    private config: ConfigService,
    private codes: AuthCodesService,
    private mailer: MailerService,
  ) {}

  /** Seed the first admin from env if no admin exists yet. */
  async onModuleInit(): Promise<void> {
    const count = await this.users.count();
    if (count > 0) return;

    const username = this.config.get<string>('AUTH_ADMIN_USERNAME', 'admin');
    const password = this.config.get<string>('AUTH_ADMIN_PASSWORD');
    if (!password) {
      this.logger.warn(
        'No admin user and AUTH_ADMIN_PASSWORD is unset — dashboard login is unavailable until you set it and restart.',
      );
      return;
    }
    await this.users.save(
      this.users.create({
        username,
        passwordHash: await bcrypt.hash(password, 12),
        // The account that seeds the household owns account management.
        role: 'admin',
        displayName: 'Parent',
      }),
    );
    this.logger.log(`Seeded initial admin user "${username}"`);
  }

  /**
   * Sign in, with the throttling that Cloudflare Access has been quietly
   * providing until now.
   *
   * Two independent ceilings, because the two attacks look nothing alike:
   *  - per USERNAME, which stops a targeted grind against one account even when
   *    it arrives from a hundred addresses;
   *  - per IP, which stops one host spraying one password across every username
   *    it can think of.
   *
   * Keyed on the SUBMITTED username, never on a resolved account, so an
   * attacker cannot tell a real account from a fictional one by whether they
   * get locked out. Only failures accumulate — a correct password clears the
   * count, so ordinary fumbling never builds toward a lockout.
   */
  async login(
    username: string,
    password: string,
    ip: string | null = null,
  ): Promise<{ token: string }> {
    const key = (username ?? '').trim().toLowerCase();

    const accountWait = AuthService.loginPerAccount.count(key) >= LOGIN_MAX_PER_ACCOUNT
      ? AuthService.loginPerAccount.retryAfterSeconds(key)
      : 0;
    const ipWait = ip && AuthService.loginPerIp.count(ip) >= LOGIN_MAX_PER_IP
      ? AuthService.loginPerIp.retryAfterSeconds(ip)
      : 0;
    const wait = Math.max(accountWait, ipWait);
    if (wait > 0) {
      this.logger.warn(`login throttled for "${key}"${ip ? ` from ${ip}` : ''}`);
      throw new TooManyRequestsException(wait);
    }

    // Record the attempt against both ceilings before evaluating it.
    AuthService.loginPerAccount.allow(key);
    if (ip) AuthService.loginPerIp.allow(ip);

    const user = await this.users.findOne({ where: { username: key } });
    // An invited account has no hash yet: it must go through its invite link,
    // never a password guess. Compare against a dummy hash when there is no
    // user so an unknown username costs the same time as a known one — without
    // this, response timing alone distinguishes the two.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(password ?? '', hash);
    const ok = !!user && !!user.passwordHash && matches;

    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Success clears this account's count; the IP's count stands, so a host
    // grinding many accounts cannot launder its record with one good login.
    AuthService.loginPerAccount.reset(key);
    return { token: await this.signFor(user!) };
  }

  private signFor(user: AdminUser): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role ?? 'parent',
    });
  }

  // ---- parent accounts -------------------------------------------------

  async listUsers(): Promise<
    Array<Pick<AdminUser, 'id' | 'username' | 'displayName' | 'email' | 'role' | 'createdAt'> & {
      pendingInvite: boolean;
      hasPassword: boolean;
    }>
  > {
    const all = await this.users.find({ order: { createdAt: 'ASC' } });
    return all.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      role: u.role ?? 'parent',
      createdAt: u.createdAt,
      hasPassword: !!u.passwordHash,
      pendingInvite: !!u.inviteTokenHash && !!u.inviteExpiresAt && u.inviteExpiresAt > new Date(),
    }));
  }

  /** Whoever is asking — used to gate the admin-only endpoints. */
  async findById(id: string): Promise<AdminUser | null> {
    return this.users.findOne({ where: { id } });
  }

  /**
   * Create a parent account with no password. They get in via a one-time link
   * and choose their own; nobody ever types a password on someone else's
   * behalf, and no plaintext is passed around the house.
   */
  async createUser(input: {
    username: string;
    displayName?: string;
    email?: string;
    role?: 'admin' | 'parent';
  }): Promise<{ id: string; token: string; expiresAt: Date }> {
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new BadRequestException(
        'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.',
      );
    }
    if (await this.users.findOne({ where: { username } })) {
      throw new BadRequestException(`There is already an account called "${username}".`);
    }
    const user = this.users.create({
      username,
      displayName: input.displayName?.trim() || null,
      email: input.email?.trim() || null,
      role: input.role ?? 'parent',
      passwordHash: null,
    });
    const saved = await this.users.save(user);
    const invite = await this.issueInvite(saved.id);
    this.logger.log(`Created parent account "${username}" (${saved.role})`);
    return { id: saved.id, ...invite };
  }

  /**
   * Mint a fresh single-use link. This is the "forgot password" path: there is
   * no mailer in this stack, and Cloudflare Access already gates the dashboard,
   * so the other parent hands over a link instead.
   */
  async issueInvite(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('No such account');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    user.inviteTokenHash = sha256(token);
    user.inviteExpiresAt = expiresAt;
    await this.users.save(user);
    return { token, expiresAt };
  }

  /** Who is this link for? Lets the page say the name before asking anything. */
  async inviteHolder(token: string): Promise<{ username: string; displayName: string | null }> {
    const user = await this.findByInvite(token);
    return { username: user.username, displayName: user.displayName };
  }

  /** Redeem a link by setting a password, and sign the parent straight in. */
  async redeemInvite(token: string, newPassword: string): Promise<{ token: string }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    const user = await this.findByInvite(token);
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    // Single use: the link dies the moment it works.
    user.inviteTokenHash = null;
    user.inviteExpiresAt = null;
    await this.users.save(user);
    this.logger.log(`Account "${user.username}" set a new password via invite link`);
    return { token: await this.signFor(user) };
  }

  /**
   * Set the contact details on an account. Email matters: without one, an
   * account cannot be recovered by code — the seeded admin starts with none.
   */
  async updateUser(
    id: string,
    patch: { displayName?: string | null; email?: string | null },
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('No such account');

    if (patch.email !== undefined) {
      const email = patch.email?.trim().toLowerCase() || null;
      if (email) {
        const clash = await this.users
          .createQueryBuilder('u')
          .where('LOWER(u.email) = :email AND u.id != :id', { email, id })
          .getOne();
        if (clash) {
          throw new BadRequestException('Another account already uses that address.');
        }
      }
      user.email = email;
    }
    if (patch.displayName !== undefined) {
      user.displayName = patch.displayName?.trim() || null;
    }
    await this.users.save(user);
  }

  async deleteUser(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('You cannot remove your own account.');
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('No such account');
    // Locking every admin out of the house is not a recoverable mistake.
    if ((user.role ?? 'parent') === 'admin') {
      const admins = await this.users.count({ where: { role: 'admin' } });
      if (admins <= 1) throw new BadRequestException('This is the only admin account.');
    }
    await this.users.remove(user);
    this.logger.log(`Removed parent account "${user.username}"`);
  }

  private async findByInvite(token: string): Promise<AdminUser> {
    const hash = sha256(token ?? '');
    const user = await this.users.findOne({ where: { inviteTokenHash: hash } });
    if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
      throw new UnauthorizedException('This link has expired. Ask for a new one.');
    }
    return user;
  }

  // ---- emailed reset codes ------------------------------------------

  /**
   * Start a password reset. ALWAYS reports the same thing to the caller.
   *
   * Whether the address is unknown, belongs to an account with no email, or is
   * rate-limited, the answer is identical — anything else turns this endpoint
   * into a way to ask "does this person have an account here?", which is the
   * classic leak in exactly this flow.
   */
  async requestPasswordReset(email: string, ip: string | null): Promise<void> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return;

    const user = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email: normalized })
      .getOne();
    if (!user) {
      this.logger.log('reset requested for an address with no account');
      return;
    }

    const code = await this.codes.issue(user.id, 'password_reset', ip);
    if (!code) return; // rate-limited; the caller still says "check your email"

    const sent = await this.mailer.send(
      normalized,
      'Your Home Guardian reset code',
      [
        `Your code is ${code}`,
        '',
        'It works once and expires in 10 minutes.',
        'If you did not ask for this, you can ignore this email — nothing has changed.',
      ].join('\n'),
      `<p style="font:16px system-ui">Your Home Guardian reset code is:</p>
       <p style="font:700 32px/1.2 system-ui;letter-spacing:6px">${code}</p>
       <p style="font:14px system-ui;color:#555">It works once and expires in 10 minutes.
       If you did not ask for this, ignore this email — nothing has changed.</p>`,
    );
    if (!sent) this.logger.warn('reset code generated but the email could not be sent');
  }

  /** Finish a reset: verify the code, set the password, sign them in. */
  async resetPasswordWithCode(
    email: string,
    code: string,
    newPassword: string,
    ip: string | null,
  ): Promise<{ token: string }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    const normalized = (email ?? '').trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email: normalized })
      .getOne();
    // Same vague failure as a wrong code: an unknown address must not be
    // distinguishable here either.
    if (!user) throw new BadRequestException('That code is not valid. Ask for a new one.');

    await this.codes.consume(user.id, 'password_reset', code, ip);

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    // A reset also settles any outstanding invite link for this account.
    user.inviteTokenHash = null;
    user.inviteExpiresAt = null;
    await this.users.save(user);
    this.logger.log(`Password reset by code for "${user.username}"`);
    return { token: await this.signFor(user) };
  }

  /** Can this account be recovered by email at all? Used by the UI copy. */
  mailEnabled(): boolean {
    return this.mailer.isEnabled();
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new UnauthorizedException('New password must be at least 8 characters');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.users.save(user);
  }
}
