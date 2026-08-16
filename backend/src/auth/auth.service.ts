import {
  BadRequestException,
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

/** How long an invite / reset link stays usable. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(AdminUser) private users: Repository<AdminUser>,
    private jwt: JwtService,
    private config: ConfigService,
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

  async login(username: string, password: string): Promise<{ token: string }> {
    const user = await this.users.findOne({ where: { username } });
    // An invited account has no hash yet: it must go through its invite link,
    // never a password guess.
    const ok =
      user && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new UnauthorizedException('Invalid credentials');
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
