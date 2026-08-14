import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('system')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Heartbeat snapshot: per-component up/down + dead-man ping state. */
  @Get('health')
  snapshot() {
    return this.healthService.snapshot();
  }
}
