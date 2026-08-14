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

  /** Extra minutes granted for today (a parent's "bonus time"); added to the
   * profile's daily limit when the quota is evaluated. */
  @Column({ type: 'int', default: 0 })
  bonusMinutes: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
