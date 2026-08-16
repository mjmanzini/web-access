import {
  Body,
  Controller,
  Delete,
  Patch,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

class CreateUserDto {
  @IsString() username: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(['admin', 'parent']) role?: 'admin' | 'parent';
}

class UpdateUserDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEmail() email?: string;
}

class RedeemDto {
  @IsString() @MinLength(8) password: string;
}

type Authed = Request & { user?: { sub: string; username: string; role?: string } };

/**
 * Parent accounts.
 *
 * Two levels, which is all a household needs: an `admin` can add and remove
 * parents; a `parent` can do everything else in the dashboard. There is no
 * mailer in this stack and none is needed — Cloudflare Access already gates
 * this whole origin, so anyone reaching the login page has proven control of an
 * approved email. Getting back in is therefore a link the other parent hands
 * over, which also works when the internet is down.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  /** Any signed-in parent can see who else has access — that is not a secret. */
  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  async create(@Req() req: Authed, @Body() dto: CreateUserDto) {
    await this.requireAdmin(req);
    const out = await this.auth.createUser(dto);
    return { id: out.id, ...this.linkFor(out.token, out.expiresAt) };
  }

  /** "Forgot password": an admin issues a fresh single-use link. */
  @Post(':id/reset-link')
  async resetLink(@Req() req: Authed, @Param('id') id: string) {
    await this.requireAdmin(req);
    const out = await this.auth.issueInvite(id);
    return this.linkFor(out.token, out.expiresAt);
  }

  /**
   * Edit a parent's details. An admin may edit anyone; anyone may edit their
   * own — otherwise a parent could never add the email that makes their own
   * account recoverable.
   */
  @Patch(':id')
  async update(@Req() req: Authed, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    if (req.user?.sub !== id) await this.requireAdmin(req);
    await this.auth.updateUser(id, dto);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Req() req: Authed, @Param('id') id: string) {
    await this.requireAdmin(req);
    await this.auth.deleteUser(id, req.user!.sub);
    return { ok: true };
  }

  /** Whose link is this? Shown before anything is typed. */
  @Public()
  @Get('invite/:token')
  invite(@Param('token') token: string) {
    return this.auth.inviteHolder(token);
  }

  /** Set a password from the link and sign straight in. */
  @Public()
  @Post('invite/:token')
  redeem(@Param('token') token: string, @Body() dto: RedeemDto) {
    return this.auth.redeemInvite(token, dto.password);
  }

  /**
   * Role comes from the database, not the JWT claim: a token minted before a
   * demotion would otherwise keep its old powers until it expired.
   */
  private async requireAdmin(req: Authed): Promise<void> {
    const me = req.user?.sub ? await this.auth.findById(req.user.sub) : null;
    if (!me || (me.role ?? 'parent') !== 'admin') {
      throw new ForbiddenException('Only an admin parent can manage accounts.');
    }
  }

  private linkFor(token: string, expiresAt: Date) {
    const base = (process.env.DASHBOARD_PUBLIC_URL || '').replace(/\/+$/, '');
    return {
      token,
      expiresAt,
      // Relative when no public URL is configured, so the link still works when
      // opened on the same origin.
      url: `${base}/invite/${token}`,
    };
  }
}
