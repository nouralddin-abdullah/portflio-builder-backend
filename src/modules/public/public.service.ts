import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { Tenant } from '../../database/entities/tenant.entity';
import { Portfolio } from '../../database/entities/portfolio.entity';
import { Inquiry } from '../../database/entities/inquiry.entity';
import { PageView } from '../../database/entities/page-view.entity';
import { User } from '../../database/entities/user.entity';
import { AppConfigService } from '../../config/config.service';
import { EventBus } from '../../common/events/event-bus.service';
import { ConfigCacheService, type PublicPortfolioConfig } from './config-cache.service';
import type { InquiryInput, PageviewInput } from './schemas';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Portfolio) private readonly portfolios: Repository<Portfolio>,
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(PageView) private readonly pageViews: Repository<PageView>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly cache: ConfigCacheService,
    private readonly config: AppConfigService,
    private readonly events: EventBus,
  ) {}

  /**
   * Resolves a hostname to its published PortfolioConfig. Redis-cached for
   * 60s; the public controller layers `Cache-Control: s-maxage=60,
   * stale-while-revalidate=300` on top so CDN edges handle fan-out.
   */
  async resolveConfig(host: string): Promise<PublicPortfolioConfig> {
    const cached = await this.cache.get(host);
    if (cached) return cached;

    const tenant = await this.findTenantByHost(host);
    if (!tenant) {
      throw new NotFoundException({ code: 'unknown_host', message: 'No portfolio is published at this host.' });
    }
    const portfolio = await this.portfolios.findOne({ where: { tenantId: tenant.id } });
    if (!portfolio || !portfolio.published || !portfolio.publishedAt) {
      throw new NotFoundException({
        code: 'not_published',
        message: 'No portfolio is published at this host.',
      });
    }
    const owner = await this.users.findOne({ where: { id: tenant.ownerId } });
    const config: PublicPortfolioConfig = {
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
      portfolio: {
        template: portfolio.template,
        theme: portfolio.theme,
        fontPair: portfolio.fontPair,
        enabledSections: portfolio.enabledSections,
        published: portfolio.published,
        publishedAt: portfolio.publishedAt.toISOString(),
      },
      owner: {
        name: owner?.name ?? '',
        avatarUrl: owner?.avatarUrl ?? null,
      },
    };
    await this.cache.set(host, config);
    return config;
  }

  /**
   * Accepts a public inquiry. Caller is expected to have already passed
   * rate-limit and captcha gates at the controller layer.
   */
  async submitInquiry(input: InquiryInput, ctx: RequestContext): Promise<{ id: string }> {
    const tenant = await this.tenants.findOne({ where: { id: input.tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: 'tenant_not_found', message: 'Tenant not found.' });
    }
    const inquiry = this.inquiries.create({
      tenantId: tenant.id,
      name: input.name,
      email: input.email.trim().toLowerCase(),
      subject: input.subject ?? null,
      body: input.body,
      meta: {
        ip: ctx.ip ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
        referrer: ctx.referrer ?? undefined,
      },
      readAt: null,
    });
    await this.inquiries.save(inquiry);
    this.events.emit('inquiry.received', { tenantId: tenant.id, inquiryId: inquiry.id });
    return { id: inquiry.id };
  }

  /**
   * Pageview beacon. Session hash derives from tenant + ip + ua + a
   * day-rotating salt so we get per-day session granularity without
   * retaining raw IPs — matches the §6.8 privacy constraint.
   */
  async recordPageview(input: PageviewInput, ctx: RequestContext): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { id: input.tenantId } });
    if (!tenant) {
      throw new BadRequestException({ code: 'tenant_not_found', message: 'Tenant not found.' });
    }
    const view = this.pageViews.create({
      tenantId: tenant.id,
      path: input.path.slice(0, 512),
      referrer: input.referrer ?? null,
      country: null,
      device: null,
      sessionHash: this.hashSession(tenant.id, ctx.ip ?? '', ctx.userAgent ?? ''),
    });
    await this.pageViews.save(view);
  }

  private async findTenantByHost(rawHost: string): Promise<Tenant | null> {
    const host = rawHost.trim().toLowerCase();
    const renderSuffix = this.config.renderOriginSuffix.toLowerCase(); // e.g. ".portfoli.app"
    if (host.endsWith(renderSuffix)) {
      const subdomain = host.slice(0, -renderSuffix.length);
      if (subdomain.length > 0) {
        return this.tenants.findOne({ where: { subdomain } });
      }
    }
    return this.tenants.findOne({ where: { customDomain: host } });
  }

  private hashSession(tenantId: string, ip: string, ua: string): string {
    const day = new Date().toISOString().slice(0, 10);
    const salt = `${this.config.sessionSalt}:${day}`;
    return createHash('sha256').update(`${tenantId}|${ip}|${ua}|${salt}`).digest('hex');
  }
}
