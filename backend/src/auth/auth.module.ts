import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AuthCode } from '../entities/auth-code.entity';
import { AuthService } from './auth.service';
import { AuthCodesService } from './auth-codes.service';
import { MailerService } from './mailer.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Global so JwtModule (JwtService) is injectable by the WebSocket gateway too.
 * Registers JwtAuthGuard as an APP_GUARD → every route is protected unless
 * marked @Public() (fail-closed).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminUser, AuthCode]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }, AuthCodesService, MailerService],
  exports: [JwtModule],
})
export class AuthModule {}
