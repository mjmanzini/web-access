import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../entities/profile.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { ReportsService } from './reports.service';
import { DigestService } from './digest.service';
import { ReportsController } from './reports.controller';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, DailyUsage]), ActivityModule],
  controllers: [ReportsController],
  providers: [ReportsService, DigestService],
})
export class ReportsModule {}
