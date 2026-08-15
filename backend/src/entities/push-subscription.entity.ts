import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A browser's Web Push subscription — one row per installed dashboard.
 *
 * The endpoint is the push service's URL for this device and is unique, so a
 * re-subscribe (which browsers do periodically) updates in place rather than
 * accumulating dead rows. Nothing here identifies a person; it is a delivery
 * address plus the keys needed to encrypt to it.
 *
 * NOTE: `synchronize` is off in production, so this table is created by an
 * explicit migration, not by TypeORM. See the accompanying SQL in the commit.
 */
@Entity('push_subscriptions')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'text' })
  endpoint: string;

  /** Client public key for payload encryption (base64url). */
  @Column({ type: 'varchar' })
  p256dh: string;

  /** Client auth secret (base64url). */
  @Column({ type: 'varchar' })
  auth: string;

  /**
   * Which child device this subscription belongs to, or NULL for a parent's
   * dashboard. Parent broadcasts deliberately exclude device-scoped rows: a
   * child must never receive household alerts, only messages about their own
   * device.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  /** Free-text label so a parent can tell devices apart later. */
  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  /** Consecutive delivery failures; used to retire dead endpoints. */
  @Column({ type: 'int', default: 0 })
  failures: number;

  @CreateDateColumn()
  createdAt: Date;
}
