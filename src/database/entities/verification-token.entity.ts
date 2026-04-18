import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { createId } from '../id';
import { User } from './user.entity';

export const VERIFICATION_PURPOSES = ['email_verify', 'email_change'] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

@Entity({ name: 'verification_tokens' })
@Index(['userId', 'purpose'])
export class VerificationToken {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 24 })
  userId!: string;

  @Column({ name: 'token_hash', unique: true })
  tokenHash!: string;

  @Column({ type: 'enum', enum: VERIFICATION_PURPOSES, enumName: 'verification_purpose' })
  purpose!: VerificationPurpose;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
