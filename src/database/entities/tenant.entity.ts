import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../id';
import { User } from './user.entity';
import { Portfolio } from './portfolio.entity';

export const PUBLISH_STATUSES = ['draft', 'published', 'archived'] as const;
export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

@Entity({ name: 'tenants' })
@Index(['subdomain'])
@Index(['customDomain'])
export class Tenant {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 24, unique: true })
  ownerId!: string;

  @Column({ unique: true })
  subdomain!: string;

  @Column({ name: 'custom_domain', type: 'varchar', unique: true, nullable: true })
  customDomain!: string | null;

  @Column({
    type: 'enum',
    enum: PUBLISH_STATUSES,
    enumName: 'publish_status',
    default: 'draft',
  })
  status!: PublishStatus;

  @Column({ name: 'onboarded_at', type: 'timestamptz', nullable: true })
  onboardedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => User, (u) => u.tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @OneToOne(() => Portfolio, (p) => p.tenant)
  portfolio?: Portfolio;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
