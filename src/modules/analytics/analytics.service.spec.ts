import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import type { DailyStat, TopPath } from '../../database/entities/daily-stat.entity';
import type { PageView } from '../../database/entities/page-view.entity';
import type { Tenant } from '../../database/entities/tenant.entity';

function isBetween(v: unknown): v is { _type: 'between'; _value: [unknown, unknown] } {
  return !!v && typeof v === 'object' && (v as { _type?: string })._type === 'between';
}

function isMoreThanOrEqual(v: unknown): v is { _type: 'moreThanOrEqual'; _value: Date } {
  return !!v && typeof v === 'object' && (v as { _type?: string })._type === 'moreThanOrEqual';
}

function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const actual = row[k];
    if (isBetween(v)) {
      const [lo, hi] = v._value;
      if (typeof actual === 'string' && typeof lo === 'string' && typeof hi === 'string') {
        if (actual < lo || actual > hi) return false;
        continue;
      }
      return false;
    }
    if (isMoreThanOrEqual(v)) {
      const cutoff = v._value;
      if (actual instanceof Date && cutoff instanceof Date && actual < cutoff) return false;
      continue;
    }
    if (actual !== v) return false;
  }
  return true;
}

function makeRepo<T>(seed: T[] = []) {
  const rows: T[] = [...seed];
  return {
    rows,
    async findOne(opts: { where: Record<string, unknown> }): Promise<T | null> {
      return rows.find((r) => matches(r as unknown as Record<string, unknown>, opts.where)) ?? null;
    },
    async find(opts: {
      where: Record<string, unknown>;
      order?: Record<string, 'ASC' | 'DESC'>;
    }): Promise<T[]> {
      const out = rows.filter((r) =>
        matches(r as unknown as Record<string, unknown>, opts.where),
      );
      if (opts.order) {
        const entries = Object.entries(opts.order);
        const first = entries[0];
        if (first) {
          const [key, dir] = first;
          out.sort((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[key];
            const bv = (b as unknown as Record<string, unknown>)[key];
            if (av === bv) return 0;
            const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
            return dir === 'ASC' ? cmp : -cmp;
          });
        }
      }
      return out;
    },
  };
}

const tenant = {
  id: 't1',
  ownerId: 'u1',
  subdomain: 'alice',
  customDomain: null,
  status: 'draft',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Tenant;

function build(dailies: DailyStat[] = [], pageViews: PageView[] = []) {
  const dailyRepo = makeRepo<DailyStat>(dailies);
  const pageViewRepo = makeRepo<PageView>(pageViews);
  const tenantRepo = makeRepo<Tenant>([tenant]);
  const svc = new AnalyticsService(
    dailyRepo as unknown as Repository<DailyStat>,
    pageViewRepo as unknown as Repository<PageView>,
    tenantRepo as unknown as Repository<Tenant>,
  );
  return { svc };
}

function stat(date: string, views: number, uniques: number, topPaths: TopPath[] = []): DailyStat {
  return { tenantId: 't1', date, views, uniques, topPaths } as unknown as DailyStat;
}

function view(overrides: Partial<PageView>): PageView {
  return {
    id: overrides.id ?? '1',
    tenantId: 't1',
    path: overrides.path ?? '/',
    referrer: overrides.referrer ?? null,
    country: overrides.country ?? null,
    device: null,
    sessionHash: overrides.sessionHash ?? 'hash_' + Math.random().toString(36),
    createdAt: overrides.createdAt ?? new Date(),
  } as unknown as PageView;
}

describe('AnalyticsService', () => {
  it('403s when the caller has no tenant', async () => {
    const { svc } = build();
    await expect(svc.overview('ghost', '7d')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('overview fills missing dates with zeros and sums totals', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dailies = [stat(today, 5, 3)];
    const { svc } = build(dailies);
    const out = await svc.overview('u1', '7d');
    expect(out.range).toBe('7d');
    expect(out.series).toHaveLength(7);
    expect(out.totals.views).toBe(5);
    expect(out.series.at(-1)?.date).toBe(today);
  });

  it('topPages merges topPaths across DailyStat rows', async () => {
    const today = new Date();
    const day = (offset: number) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const dailies = [
      stat(day(0), 10, 5, [{ path: '/', count: 6 }, { path: '/about', count: 4 }]),
      stat(day(1), 8, 4, [{ path: '/', count: 8 }]),
    ];
    const { svc } = build(dailies);
    const out = await svc.topPages('u1', '7d', 2);
    expect(out[0]).toEqual({ key: '/', count: 14 });
    expect(out[1]).toEqual({ key: '/about', count: 4 });
  });

  it('referrers groups by lowercased referrer, ignoring null/empty', async () => {
    const pv = [
      view({ referrer: 'https://hackernews.com/' }),
      view({ referrer: 'HTTPS://hackernews.com/' }),
      view({ referrer: null }),
      view({ referrer: '   ' }),
      view({ referrer: 'https://twitter.com' }),
    ];
    const { svc } = build([], pv);
    const out = await svc.referrers('u1', '7d');
    expect(out[0]).toEqual({ key: 'https://hackernews.com/', count: 2 });
    expect(out.find((i) => i.key === 'https://twitter.com')?.count).toBe(1);
  });

  it('countries groups by 2-letter country code', async () => {
    const pv = [
      view({ country: 'US' }),
      view({ country: 'US' }),
      view({ country: 'DE' }),
      view({ country: null }),
    ];
    const { svc } = build([], pv);
    const out = await svc.countries('u1', '30d');
    expect(out).toEqual([
      { key: 'us', count: 2 },
      { key: 'de', count: 1 },
    ]);
  });
});
