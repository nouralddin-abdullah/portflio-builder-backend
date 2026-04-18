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
import { DomainVerification } from '../../database/entities/domain-verification.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { DomainsService } from './domains.service';
import {
  DOMAIN_VERIFY_QUEUE,
  DomainsQueue,
  type DomainVerifyJob,
} from './domains.queue';

const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/**
 * Worker that re-checks pending domain verifications. Each job schedules a
 * follow-up 5 min later while still pending, so the user doesn't have to
 * poll. After 24 h without success the row is marked failed.
 */
@Injectable()
export class DomainsVerifyProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainsVerifyProcessor.name);
  private worker?: Worker<DomainVerifyJob>;

  constructor(
    @InjectRepository(DomainVerification)
    private readonly verifications: Repository<DomainVerification>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly domains: DomainsService,
    private readonly queue: DomainsQueue,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.isTest) return;
    this.worker = new Worker<DomainVerifyJob>(
      DOMAIN_VERIFY_QUEUE,
      (job) => this.handle(job),
      { connection: this.redis, concurrency: 3 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ msg: 'domain_verify_failed', jobId: job?.id, err });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job<DomainVerifyJob>): Promise<void> {
    const row = await this.verifications.findOne({ where: { id: job.data.verificationId } });
    if (!row) {
      this.logger.warn({ msg: 'domain_verify_missing', id: job.data.verificationId });
      return;
    }
    if (row.status === 'verified' || row.status === 'failed') return;

    const age = Date.now() - row.createdAt.getTime();
    if (age > MAX_AGE_MS) {
      row.status = 'failed';
      row.lastCheckedAt = new Date();
      await this.verifications.save(row);
      return;
    }

    const updated = await this.domains.runCheck(row);
    if (updated.status === 'verified') {
      const tenant = await this.tenants.findOne({ where: { id: updated.tenantId } });
      if (tenant && tenant.customDomain !== updated.domain) {
        tenant.customDomain = updated.domain;
        await this.tenants.save(tenant).catch((err: unknown) => {
          this.logger.warn({ msg: 'bind_custom_domain_worker_failed', err });
        });
      }
      return;
    }

    // Schedule a follow-up check in 5 minutes.
    await this.queue.enqueueVerify({ verificationId: updated.id }, 5 * 60 * 1_000);
  }
}
