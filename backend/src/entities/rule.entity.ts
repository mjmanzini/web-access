import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Profile } from './profile.entity';
import { Device } from './device.entity';

export type RuleType = 'domain' | 'category';
export type RuleAction = 'block' | 'allow';
export type RuleScope = 'global' | 'profile' | 'device';

/**
 * A single filtering rule. The backend is the source of truth; rules are
 * compiled and pushed to the network layer (AdGuard custom filtering rules with
 * a $client modifier for profile/device scope). `syncedAt` tracks reconciliation.
 */
@Entity('rules')
@Index(['scope', 'enabled'])
export class Rule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: 'domain' })
  type: RuleType;

  /** Domain (e.g. "tiktok.com") or category slug (e.g. "gaming"). */
  @Column()
  value: string;

  @Column({ type: 'varchar', default: 'block' })
  action: RuleAction;

  @Column({ type: 'varchar', default: 'global' })
  scope: RuleScope;

  @Column({ default: true })
  enabled: boolean;

  /** Set once the rule has been reconciled to the network layer. */
  @Column({ type: 'timestamptz', nullable: true })
  syncedAt: Date | null;

  // ---- Scope targets (nullable depending on `scope`) ----

  @ManyToOne(() => Profile, (profile) => profile.rules, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profileId' })
  profile: Profile | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @ManyToOne(() => Device, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device | null;

  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
