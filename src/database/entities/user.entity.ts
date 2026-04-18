import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../id';
import { Session } from './session.entity';
import { OAuthAccount } from './oauth-account.entity';
import { Tenant } from './tenant.entity';

@Entity({ name: 'users' })
@Index(['email'])
export class User {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column()
  name!: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  headline!: string | null;

  @Column({ type: 'text', nullable: true })
  location!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (t) => t.owner)
  tenant?: Tenant;

  @OneToMany(() => Session, (s) => s.user)
  sessions!: Session[];

  @OneToMany(() => OAuthAccount, (o) => o.user)
  oauthAccounts!: OAuthAccount[];

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
