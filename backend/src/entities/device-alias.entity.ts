import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Another address the same physical device has answered to.
 *
 * Merging two rows is pointless without this. A device with MAC randomization
 * leaves a DHCP lease behind on every address it has ever used, and the router
 * keeps reporting those leases long after the device moved on. So the sync
 * after a merge sees the old MAC, finds no device for it, and helpfully creates
 * the duplicate again — the merge lasts about two minutes.
 *
 * An alias says "this MAC is that device", so the next sync recognises the old
 * identity instead of minting a new one. Unlike a tombstone this suppresses
 * nothing: the device is still tracked, still enforceable, still counted. It
 * simply lands on the right row.
 *
 * NOTE: `synchronize` is off in production, so this table is created by an
 * explicit migration. See the accompanying SQL in the commit.
 */
@Entity('device_aliases')
export class DeviceAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** "ip:192.168.8.102" or "mac:5e:6c:7d:97:da:ff" — normalized, lowercase. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  key: string;

  /** The surviving device this identity belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  deviceId: string;

  /** What the absorbed row was called, for the log line only. */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
