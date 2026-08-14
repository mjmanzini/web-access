import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
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
