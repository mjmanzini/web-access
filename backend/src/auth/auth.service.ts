import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminUser } from '../entities/admin-user.entity';

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
      }),
    );
    this.logger.log(`Seeded initial admin user "${username}"`);
  }

  async login(username: string, password: string): Promise<{ token: string }> {
    const user = await this.users.findOne({ where: { username } });
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const token = await this.jwt.signAsync({ sub: user!.id, username: user!.username });
    return { token };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new UnauthorizedException('New password must be at least 8 characters');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.users.save(user);
  }
}
