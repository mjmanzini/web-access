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

  @Column()
  passwordHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
