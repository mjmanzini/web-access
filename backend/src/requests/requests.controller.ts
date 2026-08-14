import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { RequestsService } from './requests.service';
import { Public } from '../auth/public.decorator';

class SubmitRequestDto {
  @IsString() domain: string;
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

@Controller('requests')
export class RequestsController {
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
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '';
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
