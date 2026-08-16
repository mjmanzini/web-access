import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A short-lived numeric code emailed to a parent.
 *
 * Deliberately generic in `purpose` so the same machinery serves password
 * resets and, when wanted, a login second factor — one table, one issue/verify
 * path, one set of rate limits to reason about.
 *
 * The code itself is NEVER stored. A database read must not be convertible into
 * an account takeover, so only a SHA-256 hash is kept, exactly as the invite
 * links do. `attempts` is on the row rather than in memory so guessing survives
 * a restart being noticed.
 *
 * NOTE: `synchronize` is off in production — this table is created by an
 * explicit migration. See the SQL in the accompanying commit.
 */
export type AuthCodePurpose = 'password_reset' | 'login_otp';

@Entity('auth_codes')
export class AuthCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar' })
  purpose: AuthCodePurpose;

  /** SHA-256 of the digits. */
  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set the moment it is used — a code works exactly once. */
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  /** Wrong guesses against this code; burnt after a handful. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Who asked, for rate-limit forensics. Not shown to anyone. */
  @Column({ type: 'varchar', nullable: true })
  requestIp: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
