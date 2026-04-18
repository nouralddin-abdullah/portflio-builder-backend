import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { createId } from '../id';
import { Portfolio } from './portfolio.entity';

export interface AssetDerivative {
  width: number;
  url: string;
  key: string;
}

@Entity({ name: 'assets' })
@Index(['portfolioId'])
@Index(['ownerId'])
export class Asset {
  @PrimaryColumn({ type: 'varchar', length: 24 })
  id!: string;

  @Column({ name: 'portfolio_id', type: 'varchar', length: 24 })
  portfolioId!: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 24 })
  ownerId!: string;

  @Column({ unique: true })
  key!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column()
  mime!: string;

  @Column({ name: 'byte_size', type: 'integer' })
  byteSize!: number;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  derivatives!: AssetDerivative[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => Portfolio, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio!: Portfolio;

  @BeforeInsert()
  assignId(): void {
    if (!this.id) this.id = createId();
  }
}
