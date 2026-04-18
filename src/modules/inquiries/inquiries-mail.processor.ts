import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { Inquiry } from '../../database/entities/inquiry.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { MailService } from './mail.service';
import {
  INQUIRY_MAIL_QUEUE,
  type InquiryMailJob,
} from './inquiries.queue';

/**
 * Worker that delivers a submitted inquiry to the owner. Skips boot under
 * test so Jest doesn't open a live Redis subscriber. Production should
 * additionally run this worker out-of-process via the `worker` service.
 */
@Injectable()
export class InquiriesMailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InquiriesMailProcessor.name);
  private worker?: Worker<InquiryMailJob>;

  constructor(
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return;
    this.worker = new Worker<InquiryMailJob>(
      INQUIRY_MAIL_QUEUE,
      (job) => this.handle(job),
      { connection: this.redis, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ msg: 'inquiry_mail_failed', jobId: job?.id, err });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job<InquiryMailJob>): Promise<void> {
    const { inquiryId, tenantId } = job.data;
    const inquiry = await this.inquiries.findOne({ where: { id: inquiryId } });
    if (!inquiry) {
      this.logger.warn({ msg: 'inquiry_mail_missing', inquiryId });
      return;
    }
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      this.logger.warn({ msg: 'inquiry_mail_tenant_missing', tenantId });
      return;
    }
    const owner = await this.users.findOne({ where: { id: tenant.ownerId } });
    if (!owner) {
      this.logger.warn({ msg: 'inquiry_mail_owner_missing', tenantId });
      return;
    }

    const subject = inquiry.subject
      ? `New inquiry: ${inquiry.subject}`
      : `New inquiry from ${inquiry.name}`;
    const text = [
      `From: ${inquiry.name} <${inquiry.email}>`,
      inquiry.subject ? `Subject: ${inquiry.subject}` : null,
      '',
      inquiry.body,
      '',
      '— Sent via your Portfoli contact form.',
    ]
      .filter((v): v is string => v !== null)
      .join('\n');

    await this.mail.send({
      to: owner.email,
      subject,
      text,
      replyTo: inquiry.email,
    });
  }
}
