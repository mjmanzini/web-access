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
import { UpdateDeviceDto } from './dto/device.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

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
