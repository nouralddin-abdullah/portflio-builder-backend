import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { PublicService } from './public.service';
import type { Tenant } from '../../database/entities/tenant.entity';
import type { Portfolio } from '../../database/entities/portfolio.entity';
import type { Inquiry } from '../../database/entities/inquiry.entity';
import type { PageView } from '../../database/entities/page-view.entity';
import type { User } from '../../database/entities/user.entity';
import type { ConfigCacheService, PublicPortfolioConfig } from './config-cache.service';
import type { AppConfigService } from '../../config/config.service';
import { EventBus } from '../../common/events/event-bus.service';

function makeRepo<T extends { id?: string | number }>(seed: T[] = []) {
  const rows = new Map<string | number, T>(
    seed.map((r) => [r.id as string | number, r]),
  );
  let counter = 0;
  return {
    rows,
    create(data: Partial<T>): T {
      counter += 1;
      return {
        id: `row_${counter}`,
        createdAt: new Date(),
        ...data,
      } as unknown as T;
    },
    async save(row: T): Promise<T> {
      rows.set(row.id as string | number, row);
      return row;
    },
    async findOne(opts: { where: Partial<T> }): Promise<T | null> {
      for (const r of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((r as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return r;
      }
      return null;
    },
  };
}

function makeCache(): jest.Mocked<Pick<ConfigCacheService, 'get' | 'set'>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(): AppConfigService {
  return {
    renderOriginSuffix: '.portfoli.app',
    sessionSalt: 'test-salt-abcdef',
    isProduction: false,
  } as unknown as AppConfigService;
}

function seedEnv() {
  const tenant = {
    id: '000000000000000000000001',
    ownerId: 'u1',
    subdomain: 'alice',
    customDomain: null,
    status: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Tenant;
  const portfolio = {
    id: 'p_1',
    tenantId: tenant.id,
    template: 'minimal',
    theme: 'ink',
    fontPair: 'editorial',
    enabledSections: ['hero'],
    draft: { hero: { title: 'Hi' } },
    published: { hero: { title: 'Hi' } },
    publishedAt: new Date('2026-04-01T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Portfolio;
  const user = {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    avatarUrl: null,
  } as unknown as User;
  return { tenant, portfolio, user };
}

function build(overrides: { tenant?: Tenant; portfolio?: Portfolio | null; user?: User } = {}) {
  const seeds = seedEnv();
  const tenant = overrides.tenant ?? seeds.tenant;
  const portfolio = overrides.portfolio === null ? null : overrides.portfolio ?? seeds.portfolio;
  const user = overrides.user ?? seeds.user;

  const tenantRepo = makeRepo<Tenant>([tenant]);
  const portfolioRepo = makeRepo<Portfolio>(portfolio ? [portfolio] : []);
  const inquiryRepo = makeRepo<Inquiry>();
  const pageViewRepo = makeRepo<PageView>();
  const userRepo = makeRepo<User>([user]);

  const cache = makeCache();
  const events = new EventBus();
  const emitSpy = jest.spyOn(events, 'emit');

  const svc = new PublicService(
    tenantRepo as unknown as Repository<Tenant>,
    portfolioRepo as unknown as Repository<Portfolio>,
    inquiryRepo as unknown as Repository<Inquiry>,
    pageViewRepo as unknown as Repository<PageView>,
    userRepo as unknown as Repository<User>,
    cache as unknown as ConfigCacheService,
    makeConfig(),
    events,
  );

  return { svc, cache, inquiryRepo, pageViewRepo, emitSpy };
}

describe('PublicService', () => {
  describe('resolveConfig', () => {
    it('returns a cached config when present', async () => {
      const { svc, cache } = build();
      const cached: PublicPortfolioConfig = {
        tenantId: 't_cached',
        subdomain: 'alice',
        customDomain: null,
        portfolio: {
          template: 'minimal',
          theme: 'ink',
          fontPair: 'editorial',
          enabledSections: [],
          published: {},
          publishedAt: '2026-01-01T00:00:00Z',
        },
        owner: { name: 'Alice', avatarUrl: null },
      };
      cache.get.mockResolvedValueOnce(cached);
      const out = await svc.resolveConfig('alice.portfoli.app');
      expect(out.tenantId).toBe('t_cached');
    });

    it('resolves by subdomain stripping the render suffix', async () => {
      const { svc, cache } = build();
      const out = await svc.resolveConfig('alice.portfoli.app');
      expect(out.subdomain).toBe('alice');
      expect(out.portfolio.published).toEqual({ hero: { title: 'Hi' } });
      expect(cache.set).toHaveBeenCalled();
    });

    it('resolves by custom domain when the host is not a render suffix', async () => {
      const seeds = seedEnv();
      const tenant = { ...seeds.tenant, customDomain: 'alice.dev', subdomain: 'alice' } as Tenant;
      const { svc } = build({ tenant });
      const out = await svc.resolveConfig('alice.dev');
      expect(out.customDomain).toBe('alice.dev');
    });

    it('404s when the portfolio has no published snapshot', async () => {
      const seeds = seedEnv();
      const portfolio = { ...seeds.portfolio, published: null, publishedAt: null } as Portfolio;
      const { svc } = build({ portfolio });
      await expect(svc.resolveConfig('alice.portfoli.app')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submitInquiry', () => {
    it('persists and emits inquiry.received', async () => {
      const { svc, inquiryRepo, emitSpy } = build();
      const out = await svc.submitInquiry(
        {
          tenantId: '000000000000000000000001',
          name: 'Bob',
          email: 'Bob@Example.com',
          body: 'Hello',
          captchaToken: 'tok',
        },
        { ip: '1.2.3.4', userAgent: 'ua' },
      );
      expect(out.id).toBeDefined();
      expect(inquiryRepo.rows.size).toBe(1);
      const [row] = Array.from(inquiryRepo.rows.values());
      expect(row?.email).toBe('bob@example.com');
      expect(emitSpy).toHaveBeenCalledWith('inquiry.received', expect.any(Object));
    });

    it('404s when the tenant is unknown', async () => {
      const { svc } = build();
      await expect(
        svc.submitInquiry(
          {
            tenantId: '000000000000000000000009',
            name: 'Bob',
            email: 'b@x.com',
            body: 'Hi',
            captchaToken: 'tok',
          },
          {},
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordPageview', () => {
    it('stores a hashed session key, never the raw IP', async () => {
      const { svc, pageViewRepo } = build();
      await svc.recordPageview(
        { tenantId: '000000000000000000000001', path: '/', referrer: 'https://search' },
        { ip: '9.9.9.9', userAgent: 'ua' },
      );
      const [row] = Array.from(pageViewRepo.rows.values());
      expect(row?.sessionHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain('9.9.9.9');
    });

    it('400s on unknown tenant', async () => {
      const { svc } = build();
      await expect(
        svc.recordPageview({ tenantId: '000000000000000000000009', path: '/' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
