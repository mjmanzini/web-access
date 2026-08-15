import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Request } from 'express';
import { RequestsService } from './requests.service';
import { Public } from '../auth/public.decorator';
import { RateLimiter } from '../common/rate-limit.util';

class SubmitRequestDto {
  // Hostname only — no schemes, paths or wildcards reach the rule engine.
  @IsString()
  @MaxLength(253)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
    message: 'domain must be a hostname like example.com',
  })
  domain: string;

  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

@Controller('requests')
export class RequestsController {
  /**
   * Abuse damping for the only unauthenticated write in the app: 5 submissions
   * per source IP per 10 minutes. A child retrying a typo is unaffected; a bot
   * that finds the public URL cannot flood the parent's queue.
   */
  private static readonly limiter = new RateLimiter(5, 10 * 60_000);

  constructor(private readonly requests: RequestsService) {}

  /**
   * Public: a device asks a parent to unblock a domain. Identified by source IP
   * → device/profile. This is the only unauthenticated write, scoped to raising
   * a pending request (no privileged effect until a parent approves).
   */
  @Public()
  @Post()
  submit(@Req() req: Request, @Body() dto: SubmitRequestDto) {
    const ip =
      // Behind the Cloudflare Tunnel this is the only trustworthy client IP;
      // on the LAN it is absent and the socket address is the device itself.
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '';

    if (!RequestsController.limiter.allow(ip)) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests — try again later.',
          retryAfter: RequestsController.limiter.retryAfterSeconds(ip),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.requests.submit(ip, dto.domain, dto.note);
  }

  /** Parent-only: the pending queue. */
  @Get('pending')
  pending() {
    return this.requests.pending();
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.requests.approve(id);
  }

  @Post(':id/deny')
  deny(@Param('id') id: string) {
    return this.requests.deny(id);
  }
}
