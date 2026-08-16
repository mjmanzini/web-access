import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

class ForgotPasswordDto {
  @IsEmail() email: string;
}

class ResetPasswordDto {
  @IsEmail() email: string;
  @IsString() code: string;
  @IsString() @MinLength(8) newPassword: string;
}

class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

/** Behind Cloudflare today, but written as if it were the front door. */
function clientIp(req: Request): string | null {
  const raw =
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '';
  return raw.replace(/^::ffff:/, '') || null;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /**
   * Ask for a reset code. Answers identically whether or not the address has an
   * account — this endpoint must not double as a way to discover who is
   * registered here.
   */
  @Public()
  @Post('forgot-password')
  async forgot(@Req() req: Request, @Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email, clientIp(req));
    return {
      ok: true,
      message: 'If that address has an account, a code is on its way.',
    };
  }

  /** Redeem the code and set a new password; signs in on success. */
  @Public()
  @Post('reset-password')
  reset(@Req() req: Request, @Body() dto: ResetPasswordDto) {
    return this.auth.resetPasswordWithCode(dto.email, dto.code, dto.newPassword, clientIp(req));
  }

  /** Does this deployment have a mailer at all? Drives the login-page copy. */
  @Public()
  @Get('capabilities')
  capabilities() {
    return { emailReset: this.auth.mailEnabled() };
  }

  /** Who am I (from the verified JWT). Used by the dashboard to gate routes. */
  @Get('me')
  me(@Req() req: Request & { user?: { sub: string; username: string } }) {
    return { id: req.user?.sub, username: req.user?.username };
  }

  @Post('change-password')
  async changePassword(
    @Req() req: Request & { user?: { sub: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(req.user!.sub, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
