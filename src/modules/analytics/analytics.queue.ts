import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_BULLMQ } from '../../common/redis/redis.module';

export const ANALYTICS_ROLLUP_QUEUE = 'analytics-rollup';

export interface AnalyticsRollupJob {
  /** YYYY-MM-DD to roll up. Defaults to yesterday when the cron fires. */
  date: string;
}

@Injectable()
export class AnalyticsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsQueue.name);
  readonly rollup: Queue<AnalyticsRollupJob>;
  readonly events: QueueEvents;

  constructor(@Inject(REDIS_BULLMQ) private readonly redis: Redis) {
    const prefix = 'portfilo';
    this.rollup = new Queue<AnalyticsRollupJob>(ANALYTICS_ROLLUP_QUEUE, { connection: redis, prefix });
    this.events = new QueueEvents(ANALYTICS_ROLLUP_QUEUE, { connection: redis, prefix });
  }

  async enqueue(job: AnalyticsRollupJob): Promise<void> {
    await this.rollup.add('rollup', job, {
      jobId: `rollup:${job.date}`, // idempotent per-date
      removeOnComplete: { age: 60 * 60 * 24 * 30 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  }

  async scheduleDaily(): Promise<void> {
    // Runs daily at 00:05 UTC.
    await this.rollup.add(
      'daily',
      { date: '' },
      {
        repeat: { pattern: '5 0 * * *', tz: 'UTC' },
        jobId: 'analytics-rollup-daily',
        removeOnComplete: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await Promise.all([this.rollup.close(), this.events.close()]);
    } catch (err) {
      this.logger.warn({ msg: 'queue_close_failed', err });
    }
  }
}
