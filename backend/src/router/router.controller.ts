import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import {
  ContainmentOptions,
  ROUTER_PROVIDER,
  RouterProvider,
} from './router-provider.interface';

class ContainmentDto implements Partial<ContainmentOptions> {
  @IsOptional() @IsBoolean() forceDnsToAdguard?: boolean;
  @IsOptional() @IsString() adguardIp?: string;
  @IsOptional() @IsBoolean() blockDot?: boolean;
  @IsOptional() @IsBoolean() blockKnownDohIps?: boolean;
  @IsOptional() @IsBoolean() blockVpnPorts?: boolean;
}

@Controller('router')
export class RouterController {
  constructor(
    @Inject(ROUTER_PROVIDER) private readonly router: RouterProvider,
    private readonly config: ConfigService,
  ) {}

  /** Router health + current containment state, for the dashboard card. */
  @Get('status')
  async status() {
    const [status, containment] = await Promise.all([
      this.router.getStatus(),
      this.router.getContainmentStatus(),
    ]);
    return { enabled: this.router.isEnabled(), ...status, containment };
  }

  /**
   * Apply (or clear) the anti-bypass firewall containment. Sensible defaults:
   * everything on, forcing DNS to AdGuard's LAN IP (ADGUARD_LAN_IP).
   */
  @Post('containment')
  async containment(@Body() dto: ContainmentDto) {
    const opts: ContainmentOptions = {
      forceDnsToAdguard: dto.forceDnsToAdguard ?? true,
      adguardIp: dto.adguardIp ?? this.config.get<string>('ADGUARD_LAN_IP', ''),
      blockDot: dto.blockDot ?? true,
      blockKnownDohIps: dto.blockKnownDohIps ?? true,
      blockVpnPorts: dto.blockVpnPorts ?? true,
    };
    await this.router.applyBypassContainment(opts);
    return this.router.getContainmentStatus();
  }
}
