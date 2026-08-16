import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DeviceIdentityService } from '../portal/device-identity.service';
import { UpdateDeviceDto } from './dto/device.dto';

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly identity: DeviceIdentityService,
  ) {}

  @Get()
  findAll() {
    return this.devices.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devices.findOne(id);
  }

  /** Encrypted-DNS (DoT/DoH/DoQ) setup endpoints for pinning this device's
   * stable ClientID. Configure these on the device's OS. */
  @Get(':id/dns-setup')
  dnsSetup(@Param('id') id: string) {
    return this.devices.getDnsSetup(id);
  }

  /** Trigger an immediate device-discovery sync from the network layer. */
  /**
   * A one-time link that pairs the kid app on THIS device. The parent opens it
   * on the child's tablet; it plants a signed cookie so the status page and its
   * notifications know whose they are. Needed because neither transport can
   * identify the device by address — the LAN path is NAT'd through Docker, and
   * the HTTPS path arrives as Cloudflare.
   */
  @Post(':id/pair-link')
  async pairLink(@Param('id') id: string): Promise<{ url: string; expiresInMinutes: number }> {
    const device = await this.devices.findOne(id);
    // Prefer the HTTPS origin when one is configured: a PWA and Web Push only
    // work in a secure context, so pairing there is what makes the kid app a
    // real app rather than a bookmark.
    const base =
      (process.env.KIDS_PUBLIC_URL || '').replace(/\/+$/, '') ||
      `http://${process.env.PORTAL_HOSTNAME || 'homeguardian.co.za'}`;
    return {
      url: `${base}/pair?t=${this.identity.issuePairToken(device.id)}`,
      expiresInMinutes: 15,
    };
  }

  @Post('sync')
  sync() {
    return this.devices.syncFromNetwork();
  }

  /** Rename, block/unblock, or assign to a profile. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(id, dto);
  }

  /**
   * Forget a device. Useful for stale or infrastructure entries the discovery
   * layer picked up. It reappears if it is still on the network and queries DNS.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.devices.remove(id);
  }
}
