import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { createId } from '../id';
import { Tenant } from './tenant.entity';

export const DOMAIN_VERIFICATION_STATUSES = ['pending', 'verified', 'failed'] as const;
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];

@Entity({ name: 'domain_verifications' })
@Unique(['tenantId', 'domain'])
export class DomainVerification {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 24 })
  tenantId!: string;

  @Column()
  domain!: string;

  @Column()
  token!: string;

  @Column({
    type: 'enum',
    enum: DOMAIN_VERIFICATION_STATUSES,
    enumName: 'domain_verification_status',
    default: 'pending',
  })
  status!: DomainVerificationStatus;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt!: Date | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
