import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';

export const ASSETS_PROCESS_QUEUE = 'assets-process';
export const ASSETS_PURGE_QUEUE = 'assets-purge';

export interface AssetProcessJob {
  assetId: string;
  key: string;
}

export interface AssetPurgeJob {
  assetId: string;
  keys: string[];
}

/**
 * BullMQ queues for the asset post-upload pipeline and the R2 purge path.
 * The Worker side lives in `assets-process.processor.ts`; in dev it boots
 * in-process, in prod it should run as a dedicated `worker` service.
 */
@Injectable()
export class AssetsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AssetsQueue.name);
  readonly process: Queue<AssetProcessJob>;
  readonly purge: Queue<AssetPurgeJob>;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.process = new Queue<AssetProcessJob>(ASSETS_PROCESS_QUEUE, { connection: redis });
    this.purge = new Queue<AssetPurgeJob>(ASSETS_PURGE_QUEUE, { connection: redis });
  }

  async enqueueProcess(job: AssetProcessJob): Promise<void> {
    await this.process.add('process', job, {
      removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  }

  async enqueuePurge(job: AssetPurgeJob): Promise<void> {
    await this.purge.add('purge', job, {
      removeOnComplete: true,
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      attempts: 5,
      backoff: { type: 'exponential', delay: 15_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.process.close();
      await this.purge.close();
    } catch (err) {
      this.logger.warn({ msg: 'queue_close_failed', err });
    }
  }
}
