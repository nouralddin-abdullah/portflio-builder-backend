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
import { Tenant } from './tenant.entity';

export interface InquiryMeta {
  ip?: string;
  userAgent?: string;
  referrer?: string;
}

@Entity({ name: 'inquiries' })
@Index(['tenantId', 'createdAt'])
export class Inquiry {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 24 })
  tenantId!: string;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  meta!: InquiryMeta;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

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
