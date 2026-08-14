import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import { ActivityService } from '../activity/activity.service';

export interface ProfileReport {
  profileId: string;
  name: string;
  today: { usedMinutes: number; limitMinutes: number | null; bonusMinutes: number };
  last7Days: Array<{ date: string; usedMinutes: number }>;
  topDomains: Array<{ domain: string; hits: number }>;
}

/**
 * Read-only per-profile screen-time + activity report, assembled from
 * DailyUsage (minutes) and the kept ActivityRollup history (top domains). Powers
 * both the dashboard report view and the weekly digest.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(DailyUsage) private usage: Repository<DailyUsage>,
    private activity: ActivityService,
  ) {}

  async forProfile(id: string): Promise<ProfileReport> {
    const profile = await this.profiles.findOneOrFail({ where: { id } });
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

    const rows = await this.usage.find({
      where: { profileId: id, date: MoreThanOrEqual(weekAgo) },
      order: { date: 'ASC' },
    });
    const todayRow = rows.find((r) => r.date === today);
    const topDomains = await this.activity.history({ profileId: id, days: 7, limit: 10 });

    return {
      profileId: id,
      name: profile.name,
      today: {
        usedMinutes: todayRow?.usedMinutes ?? 0,
        limitMinutes: profile.dailyTimeLimitMinutes,
        bonusMinutes: todayRow?.bonusMinutes ?? 0,
      },
      last7Days: rows.map((r) => ({ date: r.date, usedMinutes: r.usedMinutes })),
      topDomains,
    };
  }

  async forAll(): Promise<ProfileReport[]> {
    const profiles = await this.profiles.find();
    return Promise.all(profiles.map((p) => this.forProfile(p.id)));
  }
}
