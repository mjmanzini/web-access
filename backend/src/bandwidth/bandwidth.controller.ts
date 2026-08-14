import { Controller, Get } from '@nestjs/common';
import { BandwidthService } from './bandwidth.service';

@Controller('bandwidth')
export class BandwidthController {
  constructor(private readonly bandwidth: BandwidthService) {}

  /** Per-device usage today + latest sampled rate (empty without a router). */
  @Get()
  summary() {
    return this.bandwidth.summary();
  }
}
