import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from '../entities/schedule.entity';
import { Profile } from '../entities/profile.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { SchedulesService } from './schedules.service';
import { SchedulerService } from './scheduler.service';
import { SchedulesController } from './schedules.controller';
import { ProfilesModule } from '../profiles/profiles.module';
import { DevicesModule } from '../devices/devices.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Schedule, Profile, DailyUsage]),
    ProfilesModule,
    DevicesModule,
    ActivityModule,
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService, SchedulerService],
})
export class SchedulesModule {}
