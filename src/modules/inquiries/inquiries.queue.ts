import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';

export const INQUIRY_MAIL_QUEUE = 'inquiry-mail';

export interface InquiryMailJob {
  inquiryId: string;
  tenantId: string;
}

/**
 * BullMQ queue that ships inquiry submissions to the tenant owner via
 * Resend. Kept as its own queue (rather than a general `mail` queue) so
 * per-job retry policies can be tuned without affecting auth mail.
 */
@Injectable()
export class InquiriesQueue implements OnModuleDestroy {
  private readonly logger = new Logger(InquiriesQueue.name);
  readonly mail: Queue<InquiryMailJob>;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.mail = new Queue<InquiryMailJob>(INQUIRY_MAIL_QUEUE, { connection: redis });
  }

  async enqueueMail(job: InquiryMailJob): Promise<void> {
    await this.mail.add('inquiry-mail', job, {
      removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.mail.close();
    } catch (err) {
      this.logger.warn({ msg: 'queue_close_failed', err });
    }
  }
}
