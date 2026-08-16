import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityRollup } from '../entities/activity-rollup.entity';

/**
 * Keeps storage bounded, on purpose rather than by luck.
 *
 * The shape of the data decides the policy. Raw query rows are enormous in
 * count and only interesting while recent — "what did the tablet do this
 * week". Daily rollups are one row per day/profile/domain/action, perhaps a
 * few thousand a year, and answer "what does this child actually use" for as
 * long as anyone cares. So: keep the raw window short, keep the rollups for a
 * year, and never let the two be confused for each other.
 *
 * Everything is env-configurable because a household with three devices and
 * one with thirty want different windows, and neither should have to edit code.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly retentionDays: number;
  private readonly rollupRetentionDays: number;
  private readonly eventRetentionDays: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ActivityLog) private readonly logs: Repository<ActivityLog>,
    @InjectRepository(ActivityRollup) private readonly rollups: Repository<ActivityRollup>,
    config: ConfigService,
  ) {
    this.retentionDays = Number(config.get('ACTIVITY_RETENTION_DAYS', 14));
    this.rollupRetentionDays = Number(config.get('ROLLUP_RETENTION_DAYS', 365));
    this.eventRetentionDays = Number(config.get('EVENT_RETENTION_DAYS', 90));
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

    // 3) The smaller tables. Each is trivial next to activity_logs, but an
    //    unbounded table is an unbounded table.
    const eventCutoff = new Date(Date.now() - this.eventRetentionDays * 86_400_000);
    const requests = await this.dataSource.query(
      `DELETE FROM access_requests WHERE "createdAt" < $1 AND status <> 'pending'`,
      [eventCutoff],
    );
    const codes = await this.dataSource.query(
      `DELETE FROM auth_codes WHERE "expiresAt" < now() - interval '1 day'`,
    );

    // 4) Rollups are the long memory, but not an infinite one.
    const rollupCutoff = new Date(Date.now() - this.rollupRetentionDays * 86_400_000);
    const oldRollups = await this.rollups.delete({
      date: LessThan(rollupCutoff.toISOString().slice(0, 10)),
    });

    // 5) Give the space back. Plain VACUUM lets Postgres reuse the pages for
    //    tomorrow's rows, which is what a steadily-pruned table wants; VACUUM
    //    FULL would return bytes to the filesystem but takes an exclusive lock,
    //    and a table that refills daily does not need it.
    await this.dataSource.query('VACUUM (ANALYZE) activity_logs');

    this.logger.log(
      `Retention: pruned ${deleted} raw rows (>${this.retentionDays}d), ` +
        `${oldRollups.affected ?? 0} rollups (>${this.rollupRetentionDays}d), ` +
        `${requests?.[1] ?? 0} settled requests, ${codes?.[1] ?? 0} expired codes`,
    );
    return { prunedBefore: cutoff.toISOString(), deleted };
  }

  /**
   * What is on disk, how fast it is growing, and how long that lasts — so the
   * question "are we going to run out of space" has an answer on screen
   * instead of being a worry.
   */
  async storage(): Promise<{
    databaseBytes: number;
    tables: Array<{ name: string; rows: number; bytes: number }>;
    rawRows: number;
    rawOldest: string | null;
    rollupRows: number;
    rowsPerDay: number;
    bytesPerDay: number;
    steadyStateBytes: number;
    retention: { rawDays: number; rollupDays: number; eventDays: number };
  }> {
    const [{ size }] = await this.dataSource.query(
      `SELECT pg_database_size(current_database())::bigint AS size`,
    );
    const tables = await this.dataSource.query(
      `SELECT relname AS name, n_live_tup::bigint AS rows,
              pg_total_relation_size(relid)::bigint AS bytes
         FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC LIMIT 6`,
    );
    const [stats] = await this.dataSource.query(
      `SELECT COUNT(*)::bigint AS rows,
              MIN(timestamp)   AS oldest,
              COUNT(*) FILTER (WHERE timestamp >= now() - interval '24 hours')::bigint AS last24h
         FROM activity_logs`,
    );
    const [{ rollups }] = await this.dataSource.query(
      `SELECT COUNT(*)::bigint AS rollups FROM activity_rollups`,
    );

    const rawRows = Number(stats.rows) || 0;
    const rowsPerDay = Number(stats.last24h) || 0;
    // Measured, not assumed: bytes actually occupied per row, including index.
    const rawTable = tables.find((t: { name: string }) => t.name === 'activity_logs');
    const bytesPerRow = rawRows > 0 ? Number(rawTable?.bytes ?? 0) / rawRows : 0;

    return {
      databaseBytes: Number(size),
      tables: tables.map((t: { name: string; rows: string; bytes: string }) => ({
        name: t.name,
        rows: Number(t.rows),
        bytes: Number(t.bytes),
      })),
      rawRows,
      rawOldest: stats.oldest ? new Date(stats.oldest).toISOString() : null,
      rollupRows: Number(rollups),
      rowsPerDay,
      bytesPerDay: Math.round(rowsPerDay * bytesPerRow),
      // Pruning means the raw table stops growing once it is a full window old.
      steadyStateBytes: Math.round(rowsPerDay * bytesPerRow * this.retentionDays),
      retention: {
        rawDays: this.retentionDays,
        rollupDays: this.rollupRetentionDays,
        eventDays: this.eventRetentionDays,
      },
    };
  }
}
