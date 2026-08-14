import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ActivityAction = 'allowed' | 'blocked' | 'rewritten';

/**
 * One DNS query as pulled from the network layer's query log. This is the raw
 * activity feed powering "domains visited", "active hours", and category alerts.
 * Denormalized (stores clientIp + resolved deviceId/profileId) so history
 * survives device re-assignment and stays fast to aggregate.
 */
@Entity('activity_logs')
@Index(['timestamp'])
@Index(['deviceId', 'timestamp'])
@Index(['domain'])
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column()
  clientIp: string;

  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  /** Queried domain (question name), lowercased. */
  @Column()
  domain: string;

  @Column({ default: 'A' })
  queryType: string;

  @Column({ type: 'varchar', default: 'allowed' })
  action: ActivityAction;

  /** Matched category/filter list, when the answer was blocked or rewritten. */
  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ type: 'varchar', nullable: true })
  upstream: string | null;

  @Column({ type: 'int', nullable: true })
  elapsedMs: number | null;
}
