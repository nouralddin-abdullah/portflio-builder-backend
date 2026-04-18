import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';

export const ACCOUNT_MAIL_QUEUE = 'account-mail';

export type AccountMailKind = 'email_verify' | 'email_change' | 'password_reset';

export interface AccountMailJob {
  kind: AccountMailKind;
  userId: string;
  /** Token id for deduping/audit; the *raw* token ships in the `link` field. */
  tokenId: string;
  /** Pre-rendered absolute URL the user should click. */
  link: string;
  /** Target mailbox. For email_change we mail the NEW address (owner confirms the switch). */
  to: string;
}

@Injectable()
export class AccountQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AccountQueue.name);
  readonly mail: Queue<AccountMailJob>;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.mail = new Queue<AccountMailJob>(ACCOUNT_MAIL_QUEUE, { connection: redis });
  }

  async enqueueMail(job: AccountMailJob): Promise<void> {
    await this.mail.add(job.kind, job, {
      removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      attempts: 5,
      backoff: { type: 'exponential', delay: 15_000 },
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
