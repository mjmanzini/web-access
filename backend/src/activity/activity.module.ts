import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityRollup } from '../entities/activity-rollup.entity';
import { DeviceDaily } from '../entities/device-daily.entity';
import { Device } from '../entities/device.entity';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { RetentionService } from './retention.service';
import { HistoryService } from './history.service';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog, ActivityRollup, Device, DeviceDaily])],
  controllers: [ActivityController],
  providers: [ActivityService, RetentionService, HistoryService],
  exports: [ActivityService],
})
export class ActivityModule {}
