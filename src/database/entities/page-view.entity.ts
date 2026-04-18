import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity({ name: 'page_views' })
@Index(['tenantId', 'createdAt'])
export class PageView {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 24 })
  tenantId!: string;

  @Column()
  path!: string;

  @Column({ type: 'text', nullable: true })
  referrer!: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  device!: string | null;

  @Column({ name: 'session_hash' })
  sessionHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
