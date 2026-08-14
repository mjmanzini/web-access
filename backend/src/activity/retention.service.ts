import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityRollup } from '../entities/activity-rollup.entity';

/**
 * Keeps the raw query-log table bounded. Nightly: aggregate everything older
 * than the retention window into `activity_rollups` (idempotent upsert), then
 * delete the raw rows. Rollups are kept indefinitely for history/reports.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ActivityLog) private readonly logs: Repository<ActivityLog>,
    config: ConfigService,
  ) {
    this.retentionDays = Number(config.get('ACTIVITY_RETENTION_DAYS', 14));
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async rollupAndPrune(): Promise<{ prunedBefore: string; deleted: number }> {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);

    // 1) Aggregate old raw rows into daily rollups (add to existing counts).
    await this.dataSource.query(
      `INSERT INTO activity_rollups (date, "profileId", domain, action, hits)
       SELECT (timestamp AT TIME ZONE 'UTC')::date AS date,
              COALESCE("profileId"::text, '')       AS "profileId",
              domain,
              action,
              COUNT(*)::int                          AS hits
       FROM activity_logs
       WHERE timestamp < $1
       GROUP BY 1, 2, 3, 4
       ON CONFLICT (date, "profileId", domain, action)
       DO UPDATE SET hits = activity_rollups.hits + EXCLUDED.hits`,
      [cutoff],
    );

    // 2) Prune the raw rows now safely represented in rollups.
    const result = await this.logs.delete({ timestamp: LessThan(cutoff) });
    const deleted = result.affected ?? 0;
    if (deleted) {
      this.logger.log(
        `Retention: rolled up + pruned ${deleted} raw rows older than ${this.retentionDays}d`,
      );
    }
    return { prunedBefore: cutoff.toISOString(), deleted };
  }
}
