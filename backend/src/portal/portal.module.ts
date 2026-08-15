import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../entities/device.entity';
import { Profile } from '../entities/profile.entity';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/** Child-facing status page. No auth, device-scoped by source IP. */
@Module({
  imports: [TypeOrmModule.forFeature([Device, Profile])],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
