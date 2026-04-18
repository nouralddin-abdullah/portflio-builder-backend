import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { DomainVerification } from '../../database/entities/domain-verification.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { DohService } from './doh.service';
import { DomainsQueue } from './domains.queue';

export interface DomainVerificationView {
  id: string;
  domain: string;
  status: DomainVerification['status'];
  token: string;
  txtRecord: string;
  txtValue: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  boundToTenant: boolean;
}

const TOKEN_PREFIX = 'portfoli-verify=';
const MAX_DOMAINS_PER_TENANT = 5;

@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    @InjectRepository(DomainVerification)
    private readonly verifications: Repository<DomainVerification>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly doh: DohService,
    private readonly queue: DomainsQueue,
  ) {}

  /**
   * Creates (or returns) a pending verification for the given domain. If
   * another tenant has already claimed the domain (verified), returns 409.
   */
  async requestVerification(userId: string, domain: string): Promise<DomainVerificationView> {
    const tenant = await this.tenantFor(userId);
    await this.assertNotGlobalConflict(tenant.id, domain);

    const existing = await this.verifications.findOne({
      where: { tenantId: tenant.id, domain },
    });
    if (existing) return this.toView(existing, tenant);

    const total = await this.verifications.count({ where: { tenantId: tenant.id } });
    if (total >= MAX_DOMAINS_PER_TENANT) {
      throw new BadRequestException({
        code: 'too_many_domains',
        message: `You can register at most ${MAX_DOMAINS_PER_TENANT} custom domains.`,
      });
    }

    const row = this.verifications.create({
      tenantId: tenant.id,
      domain,
      token: randomBytes(16).toString('hex'),
      status: 'pending',
      lastCheckedAt: null,
      verifiedAt: null,
    });
    await this.verifications.save(row);
    return this.toView(row, tenant);
  }

  /**
   * Immediate synchronous verification attempt + enqueues a retry so that
   * if DNS propagation is slow the worker picks up later. Binds the domain
   * to the tenant on success.
   */
  async verify(userId: string, domain: string): Promise<DomainVerificationView> {
    const tenant = await this.tenantFor(userId);
    const row = await this.verifications.findOne({
      where: { tenantId: tenant.id, domain },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'verification_not_found',
        message: 'Start verification via POST /tenant/custom-domain first.',
      });
    }
    const updated = await this.runCheck(row);
    if (updated.status !== 'verified') {
      await this.queue.enqueueVerify({ verificationId: updated.id }, 60_000);
    } else {
      await this.bindDomainToTenant(tenant, updated.domain);
    }
    return this.toView(updated, tenant);
  }

  /**
   * Runs one DoH lookup + updates the row. Used by the synchronous path
   * and by the worker. Returns the mutated row (not re-fetched).
   */
  async runCheck(row: DomainVerification): Promise<DomainVerification> {
    const lookupName = `_portfoli.${row.domain}`;
    const target = `${TOKEN_PREFIX}${row.token}`;
    const result = await this.doh.lookupTxt(lookupName);
    row.lastCheckedAt = new Date();
    if (result.found && result.records.some((r) => r === target)) {
      row.status = 'verified';
      row.verifiedAt = new Date();
    } else {
      row.status = 'pending';
    }
    await this.verifications.save(row);
    return row;
  }

  async unbind(userId: string): Promise<{ unbound: boolean }> {
    const tenant = await this.tenantFor(userId);
    if (!tenant.customDomain) return { unbound: false };
    tenant.customDomain = null;
    await this.tenants.save(tenant);
    return { unbound: true };
  }

  async listForUser(userId: string): Promise<DomainVerificationView[]> {
    const tenant = await this.tenantFor(userId);
    const rows = await this.verifications.find({ where: { tenantId: tenant.id } });
    return rows.map((r) => this.toView(r, tenant));
  }

  private async bindDomainToTenant(tenant: Tenant, domain: string): Promise<void> {
    if (tenant.customDomain === domain) return;
    tenant.customDomain = domain;
    try {
      await this.tenants.save(tenant);
    } catch (err) {
      this.logger.warn({ msg: 'bind_custom_domain_failed', domain, err });
      throw new ConflictException({
        code: 'custom_domain_taken',
        message: 'This custom domain is already bound elsewhere.',
      });
    }
  }

  private async assertNotGlobalConflict(tenantId: string, domain: string): Promise<void> {
    const claimedBy = await this.tenants.findOne({ where: { customDomain: domain } });
    if (claimedBy && claimedBy.id !== tenantId) {
      throw new ConflictException({
        code: 'custom_domain_taken',
        message: 'This custom domain is already in use.',
      });
    }
  }

  private async tenantFor(userId: string): Promise<Tenant> {
    const tenant = await this.tenants.findOne({ where: { ownerId: userId } });
    if (!tenant) {
      throw new ForbiddenException({
        code: 'tenant_missing',
        message: 'Create a tenant first via GET /api/tenant.',
      });
    }
    return tenant;
  }

  private toView(row: DomainVerification, tenant: Tenant): DomainVerificationView {
    return {
      id: row.id,
      domain: row.domain,
      status: row.status,
      token: row.token,
      txtRecord: `_portfoli.${row.domain}`,
      txtValue: `${TOKEN_PREFIX}${row.token}`,
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
      boundToTenant: tenant.customDomain === row.domain,
    };
  }
}
