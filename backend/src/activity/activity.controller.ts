import { Controller, Get, Post, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { RetentionService } from './retention.service';
import { Granularity, HistoryService } from './history.service';

@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly retention: RetentionService,
    private readonly historySvc: HistoryService,
  ) {}

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

  /**
   * Long-range top domains from kept rollups (survives raw-log pruning).
   *
   * Renamed off `history`, which it used to own: the audit view below now has
   * that path, and having two different shapes behind one route is how the
   * History page shipped returning an array where it expected an object.
   */
  @Get('rollup-domains')
  rollupDomains(@Query('profileId') profileId?: string, @Query('days') days?: string) {
    return this.activity.history({
      profileId,
      days: days ? Number(days) : 30,
    });
  }

  /**
   * Usage over time. Recent periods come from raw rows, older ones from the
   * nightly summaries — each period says which, so a gap is visible.
   */
  @Get('history')
  history(
    @Query('granularity') granularity?: string,
    @Query('deviceId') deviceId?: string,
    @Query('periods') periods?: string,
  ) {
    const g: Granularity =
      granularity === 'weekly' || granularity === 'monthly' ? granularity : 'daily';
    const n = Math.min(Math.max(Number(periods) || defaultPeriods(g), 1), 36);
    return this.historySvc.history(g, deviceId?.trim() || null, n);
  }

  /** Force an immediate query-log poll. */
  @Post('ingest')
  ingest() {
    return this.activity.ingest();
  }
  /** Disk usage, growth rate and headroom — see it rather than wonder. */
  @Get('storage')
  storage() {
    return this.retention.storage();
  }
}

/** Enough to show a trend without becoming a wall of bars on a phone. */
function defaultPeriods(g: Granularity): number {
  return g === 'daily' ? 14 : g === 'weekly' ? 8 : 6;
}
