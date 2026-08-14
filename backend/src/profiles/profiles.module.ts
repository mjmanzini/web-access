import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../entities/profile.entity';
import { Device } from '../entities/device.entity';
import { Rule } from '../entities/rule.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Device, Rule, DailyUsage])],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  // Exported so Devices/Rules/Schedules services can trigger re-sync.
  exports: [ProfilesService],
})
export class ProfilesModule {}
