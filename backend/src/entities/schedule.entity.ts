import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Profile } from './profile.entity';

/**
 * A recurring block window for a profile — e.g. bedtime (pause internet at 20:00
 * daily) or "homework hours". The SchedulerService evaluates these on a cron
 * tick and toggles the profile's effective internet access at the network layer.
 */
@Entity('schedules')
export class Schedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120, default: 'Bedtime' })
  label: string;

  /** Days this window applies to, 0=Sun .. 6=Sat. Empty = every day. */
  @Column('simple-array', { default: '0,1,2,3,4,5,6' })
  daysOfWeek: string[];

  /** 24h "HH:mm" local time. Windows may cross midnight (start > end). */
  @Column({ default: '20:00' })
  startTime: string;

  @Column({ default: '06:00' })
  endTime: string;

  @Column({ default: true })
  enabled: boolean;

  @ManyToOne(() => Profile, (profile) => profile.schedules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Column({ type: 'uuid' })
  profileId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
