import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { MailService, type MailMessage } from '../inquiries/mail.service';
import {
  ACCOUNT_MAIL_QUEUE,
  type AccountMailJob,
  type AccountMailKind,
} from './account.queue';

@Injectable()
export class AccountMailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountMailProcessor.name);
  private worker?: Worker<AccountMailJob>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return;
    this.worker = new Worker<AccountMailJob>(
      ACCOUNT_MAIL_QUEUE,
      (job) => this.handle(job),
      { connection: this.redis, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ msg: 'account_mail_failed', kind: job?.data.kind, jobId: job?.id, err });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job<AccountMailJob>): Promise<void> {
    const { kind, to, link } = job.data;
    const msg = this.compose(kind, to, link);
    await this.mail.send(msg);
  }

  private compose(kind: AccountMailKind, to: string, link: string): MailMessage {
    switch (kind) {
      case 'email_verify':
        return {
          to,
          subject: 'Confirm your email — Portfoli',
          text: [
            'Welcome to Portfoli!',
            '',
            'Confirm your email address by visiting the link below:',
            link,
            '',
            'This link expires in 24 hours. If you did not create an account,',
            'ignore this email.',
          ].join('\n'),
        };
      case 'email_change':
        return {
          to,
          subject: 'Confirm your new email — Portfoli',
          text: [
            'Someone (hopefully you) asked to switch their Portfoli account',
            `to this email address (${to}). Confirm the change here:`,
            link,
            '',
            'This link expires in 24 hours. If this wasn’t you, ignore this email —',
            'the change will not take effect.',
          ].join('\n'),
        };
      case 'password_reset':
        return {
          to,
          subject: 'Reset your Portfoli password',
          text: [
            'We received a request to reset your Portfoli password.',
            '',
            'If that was you, set a new password here:',
            link,
            '',
            'This link expires in 1 hour. If you did not request a reset,',
            'you can safely ignore this email.',
          ].join('\n'),
        };
    }
  }
}
