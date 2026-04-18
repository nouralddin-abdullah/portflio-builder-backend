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
import { Portfolio } from './portfolio.entity';

@Entity({ name: 'portfolio_revisions' })
@Index(['portfolioId', 'publishedAt'])
export class PortfolioRevision {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'portfolio_id', type: 'varchar', length: 24 })
  portfolioId!: string;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, unknown>;

  @CreateDateColumn({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  @Column({ name: 'published_by', type: 'varchar', length: 24 })
  publishedBy!: string;

  @ManyToOne(() => Portfolio, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio!: Portfolio;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
