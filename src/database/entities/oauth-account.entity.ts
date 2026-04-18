import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { createId } from '../id';
import { User } from './user.entity';

export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

@Entity({ name: 'oauth_accounts' })
@Unique(['provider', 'providerUid'])
@Index(['userId'])
export class OAuthAccount {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 24 })
  userId!: string;

  @Column({ type: 'enum', enum: OAUTH_PROVIDERS, enumName: 'oauth_provider' })
  provider!: OAuthProvider;

  @Column({ name: 'provider_uid' })
  providerUid!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, (u) => u.oauthAccounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
