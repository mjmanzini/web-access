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

/**
 * A single network device, tracked by IP and (when available) MAC. Devices are
 * discovered from the network layer (AdGuard clients / DHCP leases) and then
 * assigned to a Profile. `macRandomized` flags a locally-administered MAC, which
 * is how phones evade MAC-based controls.
 */
@Entity('devices')
@Index(['macAddress'])
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human label, defaults to discovered hostname. */
  @Column({ length: 160 })
  name: string;

  /**
   * Stable AdGuard ClientID — an IP-independent anchor the device embeds in its
   * encrypted-DNS (DoT/DoH/DoQ) endpoint. This is the durable identity that keeps
   * policy/pause attached to the right device across IP changes and MAC
   * randomization. Nullable only for rows created before this column existed;
   * backfilled on boot and always set on new devices.
   */
  @Column({ type: 'varchar', unique: true, nullable: true })
  clientId: string | null;

  @Index()
  @Column({ nullable: true })
  ipAddress: string;

  /** Normalized lowercase colon MAC, e.g. "a4:83:e7:00:11:22". Nullable — not
   * every discovery source exposes MAC (e.g. clients behind a router hop). */
  @Column({ type: 'varchar', nullable: true })
  macAddress: string | null;

  /** True when the MAC's locally-administered bit is set (randomized/private). */
  @Column({ default: false })
  macRandomized: boolean;

  /** OUI vendor lookup result, when known. */
  @Column({ type: 'varchar', nullable: true })
  vendor: string | null;

  /**
   * The name the device announced on the network (DHCP / router), kept apart
   * from `name` because renaming is the first thing a parent does and it
   * destroys the evidence. "Njabulo Tablet" is the useful label; "SM-X205" is
   * what identifies the hardware, and both are worth having.
   */
  @Column({ type: 'varchar', nullable: true })
  hostname: string | null;

  /** "wireless" | "ethernet", when the router says. */
  @Column({ type: 'varchar', nullable: true })
  connectionType: string | null;

  /** SSID it associated with — the 2.4 and 5 GHz bands are separate networks. */
  @Column({ type: 'varchar', nullable: true })
  ssid: string | null;

  /** "DHCP" or "Static"; a static lease means somebody decided it. */
  @Column({ type: 'varchar', nullable: true })
  addressSource: string | null;

  @Column({ default: false })
  isOnline: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  /** Device-level hard block (independent of profile policy). */
  @Column({ default: false })
  blocked: boolean;

  // ---- Relations ----

  @ManyToOne(() => Profile, (profile) => profile.devices, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'profileId' })
  profile: Profile | null;

  @Column({ type: 'uuid', nullable: true })
  profileId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
