import { Body, Controller, Delete, Get, Post, Req } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { PushService } from './push.service';

class SubscribeDto {
  @IsString() endpoint: string;
  @IsObject() keys: { p256dh: string; auth: string };
  @IsOptional() @IsString() userAgent?: string;
}

class UnsubscribeDto {
  @IsString() endpoint: string;
}

/**
 * Push subscription management. Parent-only (the global JWT guard applies):
 * these endpoints decide who gets notified about the household.
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** What the browser needs to subscribe, plus current state for the UI. */
  @Get('config')
  async config(): Promise<{ enabled: boolean; publicKey: string | null; devices: number }> {
    return {
      enabled: this.push.isEnabled(),
      publicKey: this.push.publicKey(),
      devices: await this.push.count(),
    };
  }

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Body() dto: SubscribeDto): Promise<{ ok: true }> {
    await this.push.subscribe({
      endpoint: dto.endpoint,
      keys: dto.keys,
      userAgent: dto.userAgent ?? (req.headers['user-agent'] as string) ?? undefined,
    });
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Body() dto: UnsubscribeDto): Promise<{ ok: true }> {
    await this.push.unsubscribe(dto.endpoint);
    return { ok: true };
  }

  /** Send a test notification to every subscribed device. */
  @Post('test')
  async test(): Promise<{ delivered: number }> {
    const delivered = await this.push.send({
      title: 'Home Guardian',
      body: 'Test notification — alerts will arrive like this.',
      url: '/dashboard',
      tag: 'test',
    });
    return { delivered };
  }
}
