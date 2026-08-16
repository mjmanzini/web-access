import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../entities/device.entity';
import { Profile } from '../entities/profile.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { KidsController } from './kids.controller';
import { PortalController } from './portal.controller';
import { DeviceIdentityService } from './device-identity.service';
import { PortalService } from './portal.service';

/** Child-facing status page. No auth, device-scoped by source IP. */
@Module({
  imports: [TypeOrmModule.forFeature([Device, Profile, ActivityLog])],
  controllers: [PortalController, KidsController],
  providers: [PortalService, DeviceIdentityService],
  exports: [DeviceIdentityService],
})
export class PortalModule {}
