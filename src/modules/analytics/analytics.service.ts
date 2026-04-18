import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { DailyStat } from '../../database/entities/daily-stat.entity';
import { PageView } from '../../database/entities/page-view.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { rangeToDays, type Range } from './schemas';

export interface OverviewResponse {
  range: Range;
  totals: { views: number; uniques: number };
  series: { date: string; views: number; uniques: number }[];
}

export interface TopItem {
  key: string;
  count: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(DailyStat) private readonly dailyStats: Repository<DailyStat>,
    @InjectRepository(PageView) private readonly pageViews: Repository<PageView>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  async overview(userId: string, range: Range): Promise<OverviewResponse> {
    const tenant = await this.tenantFor(userId);
    const { startDate, endDate, days } = this.rangeWindow(range);

    const rows = await this.dailyStats.find({
      where: { tenantId: tenant.id, date: Between(startDate, endDate) },
      order: { date: 'ASC' },
    });
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const series = days.map((d) => ({
      date: d,
      views: byDate.get(d)?.views ?? 0,
      uniques: byDate.get(d)?.uniques ?? 0,
    }));
    const totals = series.reduce(
      (acc, s) => ({ views: acc.views + s.views, uniques: acc.uniques + s.uniques }),
      { views: 0, uniques: 0 },
    );
    return { range, totals, series };
  }

  async topPages(userId: string, range: Range, limit = 10): Promise<TopItem[]> {
    const tenant = await this.tenantFor(userId);
    const { startDate, endDate } = this.rangeWindow(range);
    const rows = await this.dailyStats.find({
      where: { tenantId: tenant.id, date: Between(startDate, endDate) },
    });
    const merged = new Map<string, number>();
    for (const row of rows) {
      for (const p of row.topPaths) {
        merged.set(p.path, (merged.get(p.path) ?? 0) + p.count);
      }
    }
    return this.topN(merged, limit);
  }

  /**
   * Referrers/countries come from raw PageViews — richer data than the
   * aggregate and acceptable cost since we prune raw rows to 90 days.
   */
  async referrers(userId: string, range: Range, limit = 10): Promise<TopItem[]> {
    return this.groupByPageViewColumn(userId, 'referrer', range, limit);
  }

  async countries(userId: string, range: Range, limit = 20): Promise<TopItem[]> {
    return this.groupByPageViewColumn(userId, 'country', range, limit);
  }

  private async groupByPageViewColumn(
    userId: string,
    column: 'referrer' | 'country',
    range: Range,
    limit: number,
  ): Promise<TopItem[]> {
    const tenant = await this.tenantFor(userId);
    const { cutoff } = this.rangeWindow(range);
    const rows = await this.pageViews.find({
      where: { tenantId: tenant.id, createdAt: MoreThanOrEqual(cutoff) },
      select: ['referrer', 'country'],
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = this.normalizeKey(r[column]);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return this.topN(counts, limit);
  }

  private topN(map: Map<string, number>, limit: number): TopItem[] {
    return Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private normalizeKey(raw: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 120).toLowerCase();
  }

  private rangeWindow(range: Range): {
    startDate: string;
    endDate: string;
    cutoff: Date;
    days: string[];
  } {
    const daysCount = rangeToDays(range);
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - (daysCount - 1));
    const endDate = this.dateOnly(today);
    const startDate = this.dateOnly(cutoff);
    const days: string[] = [];
    for (let i = 0; i < daysCount; i += 1) {
      const d = new Date(cutoff);
      d.setUTCDate(cutoff.getUTCDate() + i);
      days.push(this.dateOnly(d));
    }
    return { startDate, endDate, cutoff, days };
  }

  private dateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
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
}
