import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS_BULLMQ } from '../../common/redis/redis.module';

export const DOMAIN_VERIFY_QUEUE = 'domain-verify';

export interface DomainVerifyJob {
  verificationId: string;
}

@Injectable()
export class DomainsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(DomainsQueue.name);
  readonly verify: Queue<DomainVerifyJob>;

  constructor(@Inject(REDIS_BULLMQ) private readonly redis: Redis) {
    this.verify = new Queue<DomainVerifyJob>(DOMAIN_VERIFY_QUEUE, { connection: redis, prefix: 'portfilo' });
  }

  async enqueueVerify(job: DomainVerifyJob, delayMs = 0): Promise<void> {
    await this.verify.add('verify', job, {
      delay: delayMs,
      removeOnComplete: { age: 60 * 60 * 24, count: 500 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.verify.close();
    } catch (err) {
      this.logger.warn({ msg: 'queue_close_failed', err });
    }
  }
}
