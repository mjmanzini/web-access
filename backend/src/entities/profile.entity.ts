import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Device } from './device.entity';
import { Rule } from './rule.entity';
import { Schedule } from './schedule.entity';

/**
 * A "User Profile" groups one or more devices (e.g. a child's phone + tablet +
 * console) under a single policy. Policy fields here are the high-level intent;
 * the network layer (AdGuard) is the enforcement point that the backend syncs
 * these values to — see NetworkProvider / AdguardService.
 */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  /** Free-form kind: 'child' | 'teen' | 'adult' | 'guest'. Drives sane defaults. */
  @Column({ default: 'child' })
  kind: string;

  // ---- Policy: content ----

  /**
   * Category slugs to block for this profile. The AdguardService maps each slug
   * to concrete enforcement (parental control, blocked services, or blocklists).
   * e.g. ['adult', 'gaming', 'social', 'gambling'].
   */
  @Column('simple-array', { default: '' })
  blockedCategories: string[];

  @Column({ default: true })
  safeSearchEnforced: boolean;

  @Column({ default: true })
  youtubeRestricted: boolean;

  /** Push anti-bypass ruleset (block public DoH/DoT resolvers + Firefox canary). */
  @Column({ default: true })
  blockDnsBypass: boolean;

  // ---- Policy: time ----

  /** Daily internet allowance in minutes. null = unlimited. */
  @Column({ type: 'int', nullable: true })
  dailyTimeLimitMinutes: number | null;

  /** Manual pause switch — when true the profile's devices are cut off now. */
  @Column({ default: false })
  internetPaused: boolean;

  /**
   * Reason the profile is currently paused, for the dashboard/alerts:
   * 'manual' | 'bedtime' | 'quota_exceeded' | null.
   */
  @Column({ type: 'varchar', nullable: true })
  pausedReason: string | null;

  // ---- Relations ----

  @OneToMany(() => Device, (device) => device.profile)
  devices: Device[];

  @OneToMany(() => Rule, (rule) => rule.profile)
  rules: Rule[];

  @OneToMany(() => Schedule, (schedule) => schedule.profile)
  schedules: Schedule[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
