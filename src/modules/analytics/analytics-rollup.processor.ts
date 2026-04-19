import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { DailyStat, type TopPath } from '../../database/entities/daily-stat.entity';
import { PageView } from '../../database/entities/page-view.entity';
import { REDIS_BULLMQ } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import {
  ANALYTICS_ROLLUP_QUEUE,
  AnalyticsQueue,
  type AnalyticsRollupJob,
} from './analytics.queue';

const PRUNE_AFTER_DAYS = 90;
const TOP_PATH_LIMIT = 20;

/**
 * Rolls `page_views` into `daily_stats` for a single UTC day, then prunes
 * raw rows older than 90 days. Runs as a cron-driven BullMQ job at 00:05
 * UTC; the in-process worker only boots outside test runs.
 */
@Injectable()
export class AnalyticsRollupProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsRollupProcessor.name);
  private worker?: Worker<AnalyticsRollupJob>;

  constructor(
    @InjectRepository(PageView) private readonly pageViews: Repository<PageView>,
    @InjectRepository(DailyStat) private readonly dailyStats: Repository<DailyStat>,
    @Inject(REDIS_BULLMQ) private readonly redis: Redis,
    private readonly config: AppConfigService,
    private readonly queue: AnalyticsQueue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.isTest) return;
    this.worker = new Worker<AnalyticsRollupJob>(
      ANALYTICS_ROLLUP_QUEUE,
      (job) => this.handle(job),
      { connection: this.redis, concurrency: 1, prefix: 'portfilo' },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ msg: 'analytics_rollup_failed', jobId: job?.id, err });
    });
    await this.queue.scheduleDaily().catch((err: unknown) => {
      this.logger.warn({ msg: 'analytics_rollup_schedule_failed', err });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job<AnalyticsRollupJob>): Promise<void> {
    const date = job.data.date || this.yesterday();
    const { start, end } = this.dayBounds(date);
    const rows = await this.pageViews
      .createQueryBuilder('pv')
      .where('pv.created_at >= :start', { start })
      .andWhere('pv.created_at < :end', { end })
      .getMany();

    const byTenant = new Map<string, PageView[]>();
    for (const r of rows) {
      const list = byTenant.get(r.tenantId) ?? [];
      list.push(r);
      byTenant.set(r.tenantId, list);
    }

    for (const [tenantId, views] of byTenant) {
      const uniques = new Set(views.map((v) => v.sessionHash)).size;
      const pathCounts = new Map<string, number>();
      for (const v of views) pathCounts.set(v.path, (pathCounts.get(v.path) ?? 0) + 1);
      const topPaths: TopPath[] = Array.from(pathCounts.entries())
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_PATH_LIMIT);

      await this.dailyStats.save({
        tenantId,
        date,
        views: views.length,
        uniques,
        topPaths,
      });
    }

    await this.pruneRawViews();
    this.logger.log({ msg: 'analytics_rollup_complete', date, tenants: byTenant.size });
  }

  private async pruneRawViews(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - PRUNE_AFTER_DAYS);
    await this.pageViews.delete({ createdAt: LessThan(cutoff) });
  }

  private yesterday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private dayBounds(date: string): { start: Date; end: Date } {
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
}
