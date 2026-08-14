import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Daily aggregate of DNS activity, kept indefinitely. RetentionService rolls raw
 * `activity_logs` into these rows and then prunes the raw data past
 * ACTIVITY_RETENTION_DAYS, so history (per profile / domain / day) survives
 * without unbounded table growth.
 *
 * Natural composite PK → clean `ON CONFLICT ... DO UPDATE` upserts. `profileId`
 * is stored as text ('' when unassigned) so NULLs don't defeat the conflict key.
 */
@Entity('activity_rollups')
@Index(['profileId', 'date'])
export class ActivityRollup {
  @PrimaryColumn({ type: 'date' })
  date: string;

  @PrimaryColumn({ default: '' })
  profileId: string;

  @PrimaryColumn()
  domain: string;

  @PrimaryColumn()
  action: string;

  @Column({ type: 'int', default: 0 })
  hits: number;
}
