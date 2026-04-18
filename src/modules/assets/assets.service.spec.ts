import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository, FindOptionsWhere, FindOptionsOrder } from 'typeorm';
import { AssetsService } from './assets.service';
import type { Asset } from '../../database/entities/asset.entity';
import type { Portfolio } from '../../database/entities/portfolio.entity';
import type { Tenant } from '../../database/entities/tenant.entity';
import type { R2Service } from './r2.service';
import type { AssetsQueue } from './assets.queue';
import { EventBus } from '../../common/events/event-bus.service';

function makeTenantRepo(seed: Tenant[] = []) {
  const rows = new Map<string, Tenant>(seed.map((t) => [t.id, t]));
  return {
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
  };
}

function makePortfolioRepo(seed: Portfolio[] = []) {
  const rows = new Map<string, Portfolio>(seed.map((p) => [p.id, p]));
  return {
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
}

interface AssetFind {
  where?: FindOptionsWhere<Asset>;
  order?: FindOptionsOrder<Asset>;
  take?: number;
}

function makeAssetRepo(seed: Asset[] = []) {
  const rows = new Map<string, Asset>(seed.map((a) => [a.id, a]));
  let counter = 0;
  const repo = {
    rows,
    create(data: Partial<Asset>): Asset {
      counter += 1;
      const now = new Date();
      return {
        id: `a_${counter}`,
        createdAt: now,
        deletedAt: null,
        derivatives: [],
        width: null,
        height: null,
        ...data,
      } as Asset;
    },
    async save(a: Asset): Promise<Asset> {
      rows.set(a.id, a);
      return a;
    },
    async findOne(opts: { where: Partial<Asset> }): Promise<Asset | null> {
      for (const a of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((a as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return a;
      }
      return null;
    },
    async find(opts: AssetFind): Promise<Asset[]> {
      const portfolioId = (opts.where as { portfolioId?: string } | undefined)?.portfolioId;
      let list = Array.from(rows.values()).filter((a) => !a.deletedAt);
      if (portfolioId) list = list.filter((a) => a.portfolioId === portfolioId);
      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return opts.take ? list.slice(0, opts.take) : list;
    },
  };
  return repo;
}

function seedEnvironment() {
  const tenant = {
    id: 't_1',
    ownerId: 'u1',
    subdomain: 'alice',
    customDomain: null,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Tenant;
  const portfolio = {
    id: 'p_1',
    tenantId: 't_1',
    template: 'minimal',
    theme: 'ink',
    fontPair: 'editorial',
    enabledSections: [],
    draft: {},
    published: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Portfolio;
  return { tenant, portfolio };
}

function build(opts: { head?: { size: number; mime: string; exists: boolean } } = {}) {
  const { tenant, portfolio } = seedEnvironment();
  const tenants = makeTenantRepo([tenant]);
  const portfolios = makePortfolioRepo([portfolio]);
  const assets = makeAssetRepo();

  const r2: jest.Mocked<Pick<R2Service, 'presignPut' | 'head' | 'delete' | 'publicUrl'>> = {
    presignPut: jest.fn().mockImplementation(async (p: { key: string; mime: string }) => ({
      uploadUrl: `https://r2/signed/${p.key}`,
      method: 'PUT',
      headers: { 'Content-Type': p.mime },
      key: p.key,
      expiresAt: new Date(Date.now() + 300_000),
    })),
    head: jest
      .fn()
      .mockResolvedValue(opts.head ?? { size: 1024, mime: 'image/webp', exists: true }),
    delete: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn().mockImplementation((key: string) => `https://cdn.example.test/${key}`),
  };

  const queue: jest.Mocked<Pick<AssetsQueue, 'enqueueProcess' | 'enqueuePurge'>> = {
    enqueueProcess: jest.fn().mockResolvedValue(undefined),
    enqueuePurge: jest.fn().mockResolvedValue(undefined),
  };

  const events = new EventBus();
  const emitSpy = jest.spyOn(events, 'emit');

  const svc = new AssetsService(
    assets as unknown as Repository<Asset>,
    portfolios as unknown as Repository<Portfolio>,
    tenants as unknown as Repository<Tenant>,
    r2 as unknown as R2Service,
    queue as unknown as AssetsQueue,
    events,
  );
  return { svc, assets, r2, queue, emitSpy, portfolio };
}

describe('AssetsService', () => {
  describe('sign', () => {
    it('rejects a non-whitelisted mime', async () => {
      const { svc } = build();
      await expect(
        svc.sign('u1', {
          filename: 'evil.svg',
          mime: 'image/svg+xml' as never,
          byteSize: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an oversized file', async () => {
      const { svc } = build();
      await expect(
        svc.sign('u1', { filename: 'big.png', mime: 'image/png', byteSize: 20 * 1024 * 1024 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns a scoped key and signed URL for a valid request', async () => {
      const { svc } = build();
      const out = await svc.sign('u1', { filename: 'avatar.png', mime: 'image/png', byteSize: 1024 });
      expect(out.key).toMatch(/^u\/u1\/p\/p_1\/[a-z0-9]+\.png$/);
      expect(out.uploadUrl).toContain('https://r2/signed/');
      expect(out.method).toBe('PUT');
    });
  });

  describe('confirm', () => {
    it('rejects a key that does not belong to the caller', async () => {
      const { svc } = build();
      await expect(
        svc.confirm('u1', 'u/u2/p/p_99/evil.png'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('errors when the R2 object is missing', async () => {
      const { svc } = build({ head: { size: 0, mime: '', exists: false } });
      await expect(
        svc.confirm('u1', 'u/u1/p/p_1/abc.png'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a HEAD mime that falls outside the whitelist', async () => {
      const { svc } = build({ head: { size: 1024, mime: 'application/pdf', exists: true } });
      await expect(
        svc.confirm('u1', 'u/u1/p/p_1/abc.png'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates the asset row, enqueues processing, emits event', async () => {
      const { svc, assets, queue, emitSpy } = build();
      const out = await svc.confirm('u1', 'u/u1/p/p_1/abc.png');
      expect(assets.rows.size).toBe(1);
      expect(out.mime).toBe('image/webp');
      expect(queue.enqueueProcess).toHaveBeenCalledWith({ assetId: out.id, key: 'u/u1/p/p_1/abc.png' });
      expect(emitSpy).toHaveBeenCalledWith('asset.uploaded', { assetId: out.id });
    });

    it('is idempotent when the same key is confirmed twice', async () => {
      const { svc, assets } = build();
      const first = await svc.confirm('u1', 'u/u1/p/p_1/abc.png');
      const second = await svc.confirm('u1', 'u/u1/p/p_1/abc.png');
      expect(second.id).toBe(first.id);
      expect(assets.rows.size).toBe(1);
    });
  });

  describe('list', () => {
    it('only returns assets owned by the caller', async () => {
      const { svc } = build();
      await svc.confirm('u1', 'u/u1/p/p_1/one.png');
      await svc.confirm('u1', 'u/u1/p/p_1/two.png');
      const rows = await svc.list('u1');
      expect(rows).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('rejects an asset owned by someone else', async () => {
      const { svc } = build();
      await expect(svc.delete('u1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes, enqueues purge for original + derivatives, emits event', async () => {
      const { svc, queue, assets, emitSpy } = build();
      const created = await svc.confirm('u1', 'u/u1/p/p_1/abc.png');
      const row = assets.rows.get(created.id)!;
      row.derivatives = [
        { width: 1600, url: 'x', key: 'u/u1/p/p_1/abc.png@1600.webp' },
        { width: 800, url: 'y', key: 'u/u1/p/p_1/abc.png@800.webp' },
      ];
      await svc.delete('u1', created.id);
      expect(assets.rows.get(created.id)?.deletedAt).not.toBeNull();
      expect(queue.enqueuePurge).toHaveBeenCalledWith({
        assetId: created.id,
        keys: [
          'u/u1/p/p_1/abc.png',
          'u/u1/p/p_1/abc.png@1600.webp',
          'u/u1/p/p_1/abc.png@800.webp',
        ],
      });
      expect(emitSpy).toHaveBeenCalledWith('asset.deleted', { assetId: created.id });
    });

    it('is idempotent on repeat deletes', async () => {
      const { svc, queue } = build();
      const created = await svc.confirm('u1', 'u/u1/p/p_1/abc.png');
      await svc.delete('u1', created.id);
      await svc.delete('u1', created.id);
      expect(queue.enqueuePurge).toHaveBeenCalledTimes(1);
    });
  });
});
