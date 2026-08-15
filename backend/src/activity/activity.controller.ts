import { Controller, Get, Post, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** Recent DNS activity, newest first; optionally just one device's. */
  @Get()
  recent(@Query('limit') limit?: string, @Query('deviceId') deviceId?: string) {
    return this.activity.recent(limit ? Number(limit) : 100, deviceId);
  }

  /** Top visited domains, optionally filtered by device/profile. */
  @Get('top-domains')
  topDomains(
    @Query('deviceId') deviceId?: string,
    @Query('profileId') profileId?: string,
    @Query('hours') hours?: string,
  ) {
    return this.activity.topDomains({
      deviceId,
      profileId,
      hours: hours ? Number(hours) : 24,
    });
  }

  /** Long-range top domains from kept rollups (survives raw-log pruning). */
  @Get('history')
  history(@Query('profileId') profileId?: string, @Query('days') days?: string) {
    return this.activity.history({
      profileId,
      days: days ? Number(days) : 30,
    });
  }

  /** Force an immediate query-log poll. */
  @Post('ingest')
  ingest() {
    return this.activity.ingest();
  }
}
