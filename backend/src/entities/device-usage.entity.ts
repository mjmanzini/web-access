import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Accrued bandwidth per device per local day, in bytes. BandwidthService turns
 * the router's cumulative per-MAC counters into deltas and adds them here, so
 * this survives nlbwmon's own accounting-period resets and gives stable daily
 * totals for the dashboard.
 */
@Entity('device_usage')
@Index(['deviceId', 'date'], { unique: true })
export class DeviceUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  deviceId: string;

  /** Local calendar day, "YYYY-MM-DD". */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'bigint', default: 0 })
  rxBytes: string; // bigint comes back as string from pg

  @Column({ type: 'bigint', default: 0 })
  txBytes: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
