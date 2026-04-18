import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { FindOptionsOrder, FindOptionsWhere, Repository } from 'typeorm';
import { PortfoliosService } from './portfolios.service';
import type { Portfolio } from '../../database/entities/portfolio.entity';
import type { PortfolioRevision } from '../../database/entities/portfolio-revision.entity';
import type { Tenant } from '../../database/entities/tenant.entity';
import { EventBus } from '../../common/events/event-bus.service';

function makeTenantRepo(seed: Tenant[] = []) {
  const rows = new Map<string, Tenant>(seed.map((t) => [t.id, t]));
  return {
    rows,
    async findOne(opts: { where: Partial<Tenant> }): Promise<Tenant | null> {
      for (const t of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((t as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return t;
      }
      return null;
    },
    async save(t: Tenant): Promise<Tenant> {
      rows.set(t.id, t);
      return t;
    },
  };
}

function makePortfolioRepo(seed: Portfolio[] = []) {
  const rows = new Map<string, Portfolio>(seed.map((p) => [p.id, p]));
  let counter = 0;
  const repo = {
    rows,
    create(data: Partial<Portfolio>): Portfolio {
      counter += 1;
      const now = new Date();
      return {
        id: `p_${counter}`,
        createdAt: now,
        updatedAt: now,
        ...data,
      } as Portfolio;
    },
    async save(p: Portfolio): Promise<Portfolio> {
      p.updatedAt = new Date();
      rows.set(p.id, p);
      return p;
    },
    async findOne(opts: { where: Partial<Portfolio> }): Promise<Portfolio | null> {
      for (const p of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((p as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return p;
      }
      return null;
    },
  };
  return repo;
}

interface RevisionFind {
  where?: FindOptionsWhere<PortfolioRevision>;
  order?: FindOptionsOrder<PortfolioRevision>;
  take?: number;
}

function makeRevisionRepo(seed: PortfolioRevision[] = []) {
  const rows = new Map<string, PortfolioRevision>(seed.map((r) => [r.id, r]));
  let counter = 0;
  const repo = {
    rows,
    create(data: Partial<PortfolioRevision>): PortfolioRevision {
      counter += 1;
      return {
        id: `r_${counter}`,
        publishedAt: new Date(),
        ...data,
      } as PortfolioRevision;
    },
    async save(r: PortfolioRevision): Promise<PortfolioRevision> {
      rows.set(r.id, r);
      return r;
    },
    async findOne(opts: { where: Partial<PortfolioRevision> }): Promise<PortfolioRevision | null> {
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
    async find(opts: RevisionFind): Promise<PortfolioRevision[]> {
      const portfolioId = (opts.where as { portfolioId?: string } | undefined)?.portfolioId;
      let list = Array.from(rows.values());
      if (portfolioId) list = list.filter((r) => r.portfolioId === portfolioId);
      list.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      return opts.take ? list.slice(0, opts.take) : list;
    },
  };
  return repo;
}

function seedTenant(): Tenant {
  return {
    id: 't_1',
    ownerId: 'u1',
    subdomain: 'alice',
    customDomain: null,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Tenant;
}

function build(seedTenants: Tenant[] = [seedTenant()], seedPortfolios: Portfolio[] = [], seedRevisions: PortfolioRevision[] = []) {
  const tenants = makeTenantRepo(seedTenants);
  const portfolios = makePortfolioRepo(seedPortfolios);
  const revisions = makeRevisionRepo(seedRevisions);
  const events = new EventBus();
  const emitSpy = jest.spyOn(events, 'emit');
  const svc = new PortfoliosService(
    portfolios as unknown as Repository<Portfolio>,
    revisions as unknown as Repository<PortfolioRevision>,
    tenants as unknown as Repository<Tenant>,
    events,
  );
  return { svc, tenants, portfolios, revisions, events, emitSpy };
}

describe('PortfoliosService', () => {
  describe('getForUser', () => {
    it('auto-creates a portfolio on first access with sane defaults', async () => {
      const { svc, portfolios } = build();
      const out = await svc.getForUser('u1');
      expect(out.template).toBe('minimal');
      expect(out.theme).toBe('ink');
      expect(out.fontPair).toBe('editorial');
      expect(out.enabledSections).toEqual([]);
      expect(portfolios.rows.size).toBe(1);
    });

    it('errors when the caller has no tenant', async () => {
      const { svc } = build([]);
      await expect(svc.getForUser('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('patches provided fields, dedupes enabledSections', async () => {
      const { svc } = build();
      await svc.getForUser('u1');
      const out = await svc.updateSettings('u1', {
        template: 'dev-log',
        enabledSections: ['hero', 'about', 'hero'],
      });
      expect(out.template).toBe('dev-log');
      expect(out.enabledSections).toEqual(['hero', 'about']);
    });
  });

  describe('upsertSection', () => {
    it('rejects unknown section kinds', async () => {
      const { svc } = build();
      await expect(
        svc.upsertSection('u1', 'sidebar', { title: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('validates hero body against the zod schema', async () => {
      const { svc } = build();
      await expect(
        svc.upsertSection('u1', 'hero', { subtitle: 'no title' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('writes a valid hero into draft', async () => {
      const { svc } = build();
      const out = await svc.upsertSection('u1', 'hero', { title: 'Hello world' });
      expect(out.draft.hero?.title).toBe('Hello world');
    });

    it('re-parses the full draft after merging', async () => {
      const { svc, portfolios } = build();
      await svc.upsertSection('u1', 'hero', { title: 'A' });
      await svc.upsertSection('u1', 'about', { body: 'My story' });
      const [p] = Array.from(portfolios.rows.values());
      expect(p?.draft).toEqual({ hero: { title: 'A' }, about: { body: 'My story' } });
    });
  });

  describe('deleteSection', () => {
    it('removes the key from draft', async () => {
      const { svc } = build();
      await svc.upsertSection('u1', 'hero', { title: 'X' });
      const out = await svc.deleteSection('u1', 'hero');
      expect(out.draft.hero).toBeUndefined();
    });
  });

  describe('publish', () => {
    it('refuses to publish when an enabled section is missing from the draft', async () => {
      const { svc } = build();
      await svc.updateSettings('u1', { enabledSections: ['hero', 'about'] });
      await svc.upsertSection('u1', 'hero', { title: 'Hi' });
      await expect(svc.publish('u1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('promotes draft to published, writes a revision, bumps tenant, emits event', async () => {
      const { svc, revisions, tenants, emitSpy } = build();
      await svc.updateSettings('u1', { enabledSections: ['hero'] });
      await svc.upsertSection('u1', 'hero', { title: 'Hi' });
      const out = await svc.publish('u1');
      expect(out.published?.hero?.title).toBe('Hi');
      expect(out.publishedAt).not.toBeNull();
      expect(revisions.rows.size).toBe(1);
      const tenant = Array.from(tenants.rows.values())[0];
      expect(tenant?.status).toBe('published');
      expect(emitSpy).toHaveBeenCalledWith(
        'portfolio.published',
        expect.objectContaining({ subdomain: 'alice' }),
      );
    });
  });

  describe('unpublish', () => {
    it('clears published and archives the tenant', async () => {
      const { svc, tenants } = build();
      await svc.updateSettings('u1', { enabledSections: ['hero'] });
      await svc.upsertSection('u1', 'hero', { title: 'Hi' });
      await svc.publish('u1');
      const out = await svc.unpublish('u1');
      expect(out.published).toBeNull();
      expect(out.publishedAt).toBeNull();
      const tenant = Array.from(tenants.rows.values())[0];
      expect(tenant?.status).toBe('archived');
    });
  });

  describe('restoreRevision', () => {
    it('rejects a revision belonging to someone else', async () => {
      const { svc } = build();
      await svc.getForUser('u1');
      await expect(svc.restoreRevision('u1', 'r_nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('restores a revision snapshot into draft without auto-publishing', async () => {
      const { svc } = build();
      await svc.updateSettings('u1', { enabledSections: ['hero'] });
      await svc.upsertSection('u1', 'hero', { title: 'First' });
      await svc.publish('u1');
      // Overwrite the draft, then restore.
      await svc.upsertSection('u1', 'hero', { title: 'Second' });
      const revisions = await svc.listRevisions('u1', undefined, 10);
      const revId = revisions.items[0]?.id;
      expect(revId).toBeDefined();
      const restored = await svc.restoreRevision('u1', revId!);
      expect(restored.draft.hero?.title).toBe('First');
      // Published stays as it was; restore does not auto-publish.
      expect(restored.published?.hero?.title).toBe('First');
    });
  });
});
