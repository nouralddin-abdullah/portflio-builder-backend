import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { InquiriesService } from './inquiries.service';
import type { Inquiry } from '../../database/entities/inquiry.entity';
import type { Tenant } from '../../database/entities/tenant.entity';

type Row = Inquiry | Tenant;

function makeRepo<T extends Row>(seed: T[] = []) {
  const rows = new Map<string, T>(seed.map((r) => [r.id, r]));
  return {
    rows,
    async findOne(opts: { where: Record<string, unknown> }): Promise<T | null> {
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
    async find(opts: {
      where: Record<string, unknown>;
      order?: Record<string, 'ASC' | 'DESC'>;
      take?: number;
    }): Promise<T[]> {
      const matches: T[] = [];
      for (const r of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if (k === 'createdAt') continue; // LessThan filter is faked below
          const actual = (r as unknown as Record<string, unknown>)[k];
          if (v && typeof v === 'object' && '_type' in (v as Record<string, unknown>)) {
            const ftype = (v as { _type?: string })._type;
            if (ftype === 'isNull' && actual !== null) {
              ok = false;
              break;
            }
            continue;
          }
          if (actual !== v) {
            ok = false;
            break;
          }
        }
        if (ok) matches.push(r);
      }
      matches.sort((a, b) => {
        const ac = (a as unknown as { createdAt: Date }).createdAt.getTime();
        const bc = (b as unknown as { createdAt: Date }).createdAt.getTime();
        return bc - ac;
      });
      return opts.take ? matches.slice(0, opts.take) : matches;
    },
    async save(row: T): Promise<T> {
      rows.set(row.id, row);
      return row;
    },
    async remove(row: T): Promise<T> {
      rows.delete(row.id);
      return row;
    },
  };
}

function seedInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: overrides.id ?? 'inq_1',
    tenantId: overrides.tenantId ?? 't1',
    name: overrides.name ?? 'Bob',
    email: overrides.email ?? 'bob@example.com',
    subject: overrides.subject ?? null,
    body: overrides.body ?? 'Hello there',
    meta: overrides.meta ?? {},
    readAt: overrides.readAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-04-10T00:00:00Z'),
  } as unknown as Inquiry;
}

function build(inquiries: Inquiry[] = [], ownerId = 'u1') {
  const tenant = {
    id: 't1',
    ownerId,
    subdomain: 'alice',
    customDomain: null,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Tenant;
  const inquiryRepo = makeRepo<Inquiry>(inquiries);
  const tenantRepo = makeRepo<Tenant>([tenant]);
  const svc = new InquiriesService(
    inquiryRepo as unknown as Repository<Inquiry>,
    tenantRepo as unknown as Repository<Tenant>,
  );
  return { svc, inquiryRepo, tenantRepo };
}

describe('InquiriesService', () => {
  it('403s when the caller has no tenant', async () => {
    const { svc } = build([], 'other_user');
    await expect(svc.list('u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only inquiries belonging to the caller tenant, newest first', async () => {
    const a = seedInquiry({ id: 'a', createdAt: new Date('2026-04-01') });
    const b = seedInquiry({ id: 'b', createdAt: new Date('2026-04-02') });
    const foreign = seedInquiry({ id: 'c', tenantId: 't999', createdAt: new Date() });
    const { svc } = build([a, b, foreign]);
    const out = await svc.list('u1');
    expect(out.items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('filters unread when requested', async () => {
    const unread = seedInquiry({ id: 'u', readAt: null });
    const read = seedInquiry({ id: 'r', readAt: new Date() });
    const { svc } = build([unread, read]);
    const out = await svc.list('u1', { unread: true });
    expect(out.items.map((i) => i.id)).toEqual(['u']);
  });

  it('markRead is idempotent and sets readAt exactly once', async () => {
    const row = seedInquiry();
    const { svc, inquiryRepo } = build([row]);
    const first = await svc.markRead('u1', 'inq_1');
    const readAt = first.readAt;
    const second = await svc.markRead('u1', 'inq_1');
    expect(second.readAt).toBe(readAt);
    expect(inquiryRepo.rows.get('inq_1')?.readAt).toBeTruthy();
  });

  it('hides cross-tenant inquiries behind a 404 rather than 403', async () => {
    const foreign = seedInquiry({ id: 'x', tenantId: 't999' });
    const { svc } = build([foreign]);
    await expect(svc.detail('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete removes the row', async () => {
    const row = seedInquiry();
    const { svc, inquiryRepo } = build([row]);
    await svc.delete('u1', 'inq_1');
    expect(inquiryRepo.rows.has('inq_1')).toBe(false);
  });

  it('truncates long bodies into a preview', async () => {
    const long = 'a'.repeat(400);
    const row = seedInquiry({ body: long });
    const { svc } = build([row]);
    const page = await svc.list('u1');
    const preview = page.items[0]!.bodyPreview;
    expect(preview.length).toBeLessThanOrEqual(140);
    expect(preview.endsWith('…')).toBe(true);
  });
});
