import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { EventBus } from '../../common/events/event-bus.service';

const CACHE_TTL_SEC = 60;

export interface PublicPortfolioConfig {
  tenantId: string;
  subdomain: string;
  customDomain: string | null;
  portfolio: {
    template: string;
    theme: string;
    fontPair: string;
    enabledSections: string[];
    published: Record<string, unknown>;
    publishedAt: string;
  };
  owner: { name: string; avatarUrl: string | null };
}

/**
 * Redis-backed cache for the public-config endpoint. Keyed independently
 * by subdomain and custom domain so a single row can serve either lookup
 * path. Listens to portfolio.published/unpublished to bust both keys.
 */
@Injectable()
export class ConfigCacheService implements OnModuleInit {
  private readonly logger = new Logger(ConfigCacheService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventBus,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    const invalidate = async ({ subdomain, customDomain }: { subdomain: string; customDomain: string | null }): Promise<void> => {
      const keys = [this.keyForSubdomain(subdomain)];
      if (customDomain) keys.push(this.keyForDomain(customDomain));
      await this.redis.del(...keys);
    };
    this.events.on('portfolio.published', invalidate);
    this.events.on('portfolio.unpublished', invalidate);
  }

  async get(host: string): Promise<PublicPortfolioConfig | null> {
    const raw = await this.redis.get(this.keyForHost(host));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicPortfolioConfig;
    } catch {
      return null;
    }
  }

  async set(host: string, value: PublicPortfolioConfig): Promise<void> {
    await this.redis.set(this.keyForHost(host), JSON.stringify(value), 'EX', CACHE_TTL_SEC);
  }

  /** Returns the Redis key that matches a raw incoming host string. */
  keyForHost(host: string): string {
    const lower = host.trim().toLowerCase();
    const suffix = this.config.renderOriginSuffix.toLowerCase();
    if (suffix && lower.endsWith(suffix)) {
      const sub = lower.slice(0, -suffix.length);
      if (sub.length > 0 && !sub.includes('.')) return this.keyForSubdomain(sub);
    }
    return lower.includes('.') ? this.keyForDomain(lower) : this.keyForSubdomain(lower);
  }

  keyForSubdomain(subdomain: string): string {
    return `public:config:sub:${subdomain.toLowerCase()}`;
  }

  keyForDomain(domain: string): string {
    return `public:config:dom:${domain.toLowerCase()}`;
  }
}
