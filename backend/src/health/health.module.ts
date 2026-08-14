import { Module } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

/** Network/router providers + EventsGateway are global; no imports needed. */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
