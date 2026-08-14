import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Accrued internet-active minutes per profile per local day, used to enforce
 * `Profile.dailyTimeLimitMinutes`. The SchedulerService bumps `usedMinutes` on
 * each tick where the profile had recent DNS activity, and resets at local
 * midnight (a new row per date).
 */
@Entity('daily_usage')
@Index(['profileId', 'date'], { unique: true })
export class DailyUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  profileId: string;

  /** Local calendar day, "YYYY-MM-DD". */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  usedMinutes: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
