import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A dashboard administrator (a parent). Home Guardian is single-tenant: one or
 * two parents share admin. Passwords are bcrypt-hashed; the first admin is
 * seeded from env on boot (AUTH_ADMIN_USERNAME / AUTH_ADMIN_PASSWORD) if the
 * table is empty. Never stores plaintext.
 */
@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  /**
   * Null until an invited parent sets one. An account with no hash cannot log
   * in at all — the invite link is the only way in, and it expires.
   */
  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  /** Shown in the UI; the username stays the login handle. */
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  /**
   * Only used to tell a parent which Cloudflare Access identity this account
   * belongs to. Nothing is ever sent here — there is no mailer.
   */
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  /**
   * 'admin' may manage other parents; 'parent' can do everything else. Two
   * levels is the right amount of hierarchy for a household.
   */
  @Column({ type: 'varchar', default: 'parent' })
  role: 'admin' | 'parent';

  /**
   * SHA-256 of the outstanding invite/reset token — never the token itself, so
   * a database read cannot be turned into an account takeover. Cleared the
   * moment it is redeemed: these are single-use.
   */
  @Column({ type: 'varchar', nullable: true })
  inviteTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  inviteExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
