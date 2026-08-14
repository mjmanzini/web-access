import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../entities/device.entity';
import { DeviceUsage } from '../entities/device-usage.entity';
import { BandwidthService } from './bandwidth.service';
import { BandwidthController } from './bandwidth.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Device, DeviceUsage])],
  controllers: [BandwidthController],
  providers: [BandwidthService],
  exports: [BandwidthService],
})
export class BandwidthModule {}
