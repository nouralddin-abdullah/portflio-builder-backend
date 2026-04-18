import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createId } from '../id';
import { Tenant } from './tenant.entity';

export const TEMPLATE_IDS = ['minimal', 'dev-log', 'compass', 'batman', 'spiderman'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const THEME_IDS = ['ink', 'warm', 'cool', 'paper'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const FONT_PAIR_IDS = ['editorial', 'technical', 'humanist', 'brutal'] as const;
export type FontPairId = (typeof FONT_PAIR_IDS)[number];

@Entity({ name: 'portfolios' })
export class Portfolio {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 24, unique: true })
  tenantId!: string;

  @Column({
    type: 'enum',
    enum: TEMPLATE_IDS,
    enumName: 'template_id',
    default: 'minimal',
  })
  template!: TemplateId;

  @Column({
    type: 'enum',
    enum: THEME_IDS,
    enumName: 'theme_id',
    default: 'ink',
  })
  theme!: ThemeId;

  @Column({
    name: 'font_pair',
    type: 'enum',
    enum: FONT_PAIR_IDS,
    enumName: 'font_pair_id',
    default: 'editorial',
  })
  fontPair!: FontPairId;

  @Column({
    name: 'enabled_sections',
    type: 'text',
    array: true,
    default: () => "ARRAY[]::text[]",
  })
  enabledSections!: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  draft!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  published!: Record<string, unknown> | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (t) => t.portfolio, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
