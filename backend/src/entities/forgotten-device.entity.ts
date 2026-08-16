import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A device a parent explicitly removed, so discovery does not put it straight
 * back.
 *
 * "Forget" used to be advisory: the next sync re-created anything still on the
 * network, which is right for a real device but wrong for the things that kept
 * coming back — a WSL vEthernet adapter and a Docker bridge, tidied away by
 * hand over and over.
 *
 * The tombstone is deliberately not permanent. It suppresses re-creation until
 * the address turns up as a *genuine LAN client* — one the router hands a DHCP
 * lease and therefore a MAC. A real device forgotten by mistake comes back on
 * its next lease; a virtual adapter, which never has one, stays gone.
 *
 * NOTE: `synchronize` is off in production, so this table is created by an
 * explicit migration. See the accompanying SQL in the commit.
 */
@Entity('forgotten_devices')
export class ForgottenDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** "ip:192.168.8.103" or "mac:aa:bb:cc:dd:ee:ff" — normalized, lowercase. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  key: string;

  /** What it was called when it was forgotten, for the log line only. */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
