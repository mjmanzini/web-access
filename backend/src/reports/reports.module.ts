import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../entities/profile.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { Device } from '../entities/device.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { ReportsService } from './reports.service';
import { DigestService } from './digest.service';
import { ReportsController } from './reports.controller';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, DailyUsage, Device, ActivityLog]), ActivityModule],
  controllers: [ReportsController],
  providers: [ReportsService, DigestService],
})
export class ReportsModule {}
