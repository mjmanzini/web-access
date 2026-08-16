import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface HistoryPeriod {
  /** ISO date of the period's first day — also the sort key. */
  start: string;
  /** "16 Aug", "Week of 11 Aug", "August 2026". */
  label: string;
  activeMinutes: number | null;
  lookups: number;
  blocked: number;
  topDomains: Array<{ domain: string; hits: number }>;
  /** Where the numbers came from, so the UI can be honest about gaps. */
  source: 'raw' | 'summary' | 'none';
}

export interface HistoryResult {
  granularity: Granularity;
  deviceId: string | null;
  periods: HistoryPeriod[];
  /** Days of raw detail retained; beyond this, summaries answer. */
  rawWindowDays: number;
}

/**
 * Usage over time, per device or across the household.
 *
 * Two sources, stitched together, because retention makes them unavoidable:
 * inside the raw window every question is answerable from `activity_logs`;
 * beyond it only the nightly summaries survive. Rather than hide that, each
 * period says which source it came from — a month whose detail has aged out is
 * still worth showing, it just cannot offer minute-level precision.
 *
 * Active minutes are the same measure the daily limit enforces (distinct
 * 5-minute buckets), so this view and the quota can never disagree.
 */
@Injectable()
export class HistoryService {
  private readonly rawWindowDays: number;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.rawWindowDays = Number(config.get('ACTIVITY_RETENTION_DAYS', 14));
  }

  async history(
    granularity: Granularity,
    deviceId: string | null,
    periods: number,
  ): Promise<HistoryResult> {
    const buckets = this.buildBuckets(granularity, periods);
    const rawCutoff = new Date(Date.now() - this.rawWindowDays * 86_400_000);

    const out: HistoryPeriod[] = [];
    for (const b of buckets) {
      // A period can straddle the retention boundary — a calendar month always
      // does, once the month is older than the window. Take the recent part
      // from raw and the older part from summaries and add them, rather than
      // picking one source and under-reporting the rest. Choosing wholesale
      // made the CURRENT month read as zero while raw held 30,000 lookups.
      const rawFrom = b.start > rawCutoff ? b.start : rawCutoff;
      const hasRaw = rawFrom < b.end;
      const hasSummary = b.start < rawCutoff;

      const raw = hasRaw
        ? await this.fromRaw({ ...b, start: rawFrom }, deviceId)
        : null;
      const summary = hasSummary
        ? await this.fromSummary({ ...b, end: b.end < rawCutoff ? b.end : rawCutoff }, deviceId)
        : null;

      out.push(this.merge(b, raw, summary));
    }
    return { granularity, deviceId, periods: out, rawWindowDays: this.rawWindowDays };
  }

  /**
   * Combine the two halves of a period that straddles the retention boundary.
   *
   * Minutes add across the halves because they measure disjoint spans of time.
   * Domain hits are summed and re-ranked, so a site heavy in the pruned half
   * still surfaces.
   */
  private merge(
    b: { start: Date; label: string },
    raw: HistoryPeriod | null,
    summary: HistoryPeriod | null,
  ): HistoryPeriod {
    const parts = [raw, summary].filter(Boolean) as HistoryPeriod[];
    const lookups = parts.reduce((n, p) => n + p.lookups, 0);
    const blocked = parts.reduce((n, p) => n + p.blocked, 0);

    const minutes = parts.reduce<number | null>((acc, p) => {
      if (p.activeMinutes === null) return acc;
      return (acc ?? 0) + p.activeMinutes;
    }, null);

    const merged = new Map<string, number>();
    for (const p of parts) {
      for (const d of p.topDomains) merged.set(d.domain, (merged.get(d.domain) ?? 0) + d.hits);
    }

    const source: HistoryPeriod['source'] =
      lookups === 0 ? 'none' : raw && summary ? 'raw' : raw ? 'raw' : 'summary';

    return {
      start: b.start.toISOString().slice(0, 10),
      label: b.label,
      activeMinutes: lookups ? minutes : null,
      lookups,
      blocked,
      topDomains: [...merged.entries()]
        .map(([domain, hits]) => ({ domain, hits }))
        .sort((a, c) => c.hits - a.hits)
        .slice(0, 5),
      source,
    };
  }

  /** Period boundaries, newest last so a chart reads left-to-right in time. */
  private buildBuckets(
    granularity: Granularity,
    count: number,
  ): Array<{ start: Date; end: Date; label: string }> {
    const out: Array<{ start: Date; end: Date; label: string }> = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      let start: Date;
      let end: Date;
      let label: string;

      if (granularity === 'daily') {
        start = new Date(now);
        start.setDate(start.getDate() - i);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 1);
        label = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      } else if (granularity === 'weekly') {
        start = new Date(now);
        start.setDate(start.getDate() - i * 7);
        // Monday-based weeks: a "week" that starts on Sunday confuses everyone
        // outside the US, and bedtime is a school-week concept.
        const dow = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - dow);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        label = `w/c ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
      } else {
        start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        label = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      }
      out.push({ start, end, label });
    }
    return out;
  }

  private async fromRaw(
    b: { start: Date; end: Date; label: string },
    deviceId: string | null,
  ): Promise<HistoryPeriod> {
    const where = deviceId ? 'AND a."deviceId" = $3' : '';
    const params: unknown[] = [b.start, b.end];
    if (deviceId) params.push(deviceId);

    const [totals] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS lookups,
              COUNT(*) FILTER (WHERE a.action = 'blocked')::int AS blocked,
              (COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM a.timestamp) / 300)) * 5)::int AS minutes
         FROM activity_logs a
        WHERE a.timestamp >= $1 AND a.timestamp < $2 ${where}`,
      params,
    );
    const domains = await this.dataSource.query(
      `SELECT a.domain, COUNT(*)::int AS hits
         FROM activity_logs a
        WHERE a.timestamp >= $1 AND a.timestamp < $2 ${where}
        GROUP BY a.domain ORDER BY hits DESC LIMIT 5`,
      params,
    );

    return {
      start: b.start.toISOString().slice(0, 10),
      label: b.label,
      activeMinutes: Number(totals?.minutes ?? 0),
      lookups: Number(totals?.lookups ?? 0),
      blocked: Number(totals?.blocked ?? 0),
      topDomains: domains.map((d: { domain: string; hits: number }) => ({
        domain: d.domain,
        hits: Number(d.hits),
      })),
      source: 'raw',
    };
  }

  private async fromSummary(
    b: { start: Date; end: Date; label: string },
    deviceId: string | null,
  ): Promise<HistoryPeriod> {
    const from = b.start.toISOString().slice(0, 10);
    const to = b.end.toISOString().slice(0, 10);

    const dailyWhere = deviceId ? 'AND "deviceId" = $3' : '';
    const params: unknown[] = [from, to];
    if (deviceId) params.push(deviceId);

    const [totals] = await this.dataSource.query(
      `SELECT COALESCE(SUM("activeMinutes"), 0)::int AS minutes,
              COALESCE(SUM(lookups), 0)::int         AS lookups,
              COALESCE(SUM(blocked), 0)::int         AS blocked
         FROM device_daily
        WHERE date >= $1 AND date < $2 ${dailyWhere}`,
      params,
    );
    const domains = await this.dataSource.query(
      `SELECT domain, SUM(hits)::int AS hits
         FROM activity_rollups
        WHERE date >= $1 AND date < $2 ${deviceId ? 'AND "deviceId" = $3' : ''}
        GROUP BY domain ORDER BY hits DESC LIMIT 5`,
      params,
    );

    const lookups = Number(totals?.lookups ?? 0);
    return {
      start: from,
      label: b.label,
      activeMinutes: lookups ? Number(totals?.minutes ?? 0) : null,
      lookups,
      blocked: Number(totals?.blocked ?? 0),
      topDomains: domains.map((d: { domain: string; hits: number }) => ({
        domain: d.domain,
        hits: Number(d.hits),
      })),
      // Nothing recorded for a period before the system existed — say so
      // rather than drawing a confident zero.
      source: lookups || domains.length ? 'summary' : 'none',
    };
  }
}
