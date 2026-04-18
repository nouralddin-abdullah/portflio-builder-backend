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

@Entity({ name: 'sessions' })
@Index(['userId'])
@Index(['expiresAt'])
export class Session {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 24 })
  userId!: string;

  @Column({ name: 'token_hash', unique: true })
  tokenHash!: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'replaced_by_id', type: 'varchar', length: 24, nullable: true })
  replacedById!: string | null;

  @ManyToOne(() => User, (u) => u.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
