import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One row per device per day: the usage numbers that survive pruning.
 *
 * `activity_rollups` groups by domain, which answers "what did they visit" but
 * can never answer "how long were they online" — minutes come from the spacing
 * of individual timestamps, and those are exactly what pruning throws away. So
 * the retention job distils them here before the raw rows go.
 *
 * Roughly a dozen devices × 365 days ≈ 4,000 rows a year. Keeping this forever
 * costs less than a single day of raw logs.
 *
 * NOTE: `synchronize` is off in production — created by explicit migration.
 */
@Entity('device_daily')
@Index(['deviceId', 'date'])
export class DeviceDaily {
  @PrimaryColumn({ type: 'date' })
  date: string;

  /** Text, not a FK: the summary must outlive the device row it describes. */
  @PrimaryColumn({ type: 'varchar' })
  deviceId: string;

  /** Denormalised so history survives a device being reassigned. */
  @Column({ type: 'varchar', nullable: true })
  deviceName: string | null;

  @Column({ type: 'varchar', nullable: true })
  profileId: string | null;

  /** Distinct 5-minute buckets in which the device asked us anything. */
  @Column({ type: 'int', default: 0 })
  activeMinutes: number;

  @Column({ type: 'int', default: 0 })
  lookups: number;

  @Column({ type: 'int', default: 0 })
  blocked: number;
}
