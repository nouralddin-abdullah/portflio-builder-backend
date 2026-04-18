import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

export interface TopPath {
  path: string;
  count: number;
}

@Entity({ name: 'daily_stats' })
export class DailyStat {
  @PrimaryColumn({ name: 'tenant_id', type: 'varchar', length: 24 })
  tenantId!: string;

  @PrimaryColumn({ type: 'date' })
  date!: string;

  @Column({ type: 'integer', default: 0 })
  views!: number;

  @Column({ type: 'integer', default: 0 })
  uniques!: number;

  @Column({ name: 'top_paths', type: 'jsonb', default: () => "'[]'::jsonb" })
  topPaths!: TopPath[];

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
