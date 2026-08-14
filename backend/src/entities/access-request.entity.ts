import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

/**
 * A "please unblock X" request raised from a device (a kid asking for a domain).
 * The parent approves/denies from the dashboard; approval creates an allow Rule.
 * Denormalized with the requesting device/profile + client IP so it stands alone
 * in the queue.
 */
@Entity('access_requests')
@Index(['status', 'createdAt'])
export class AccessRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Domain the requester wants unblocked (lowercased). */
  @Column()
  domain: string;

  /** Optional free-text reason from the requester. */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @Column()
  clientIp: string;

  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: AccessRequestStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
