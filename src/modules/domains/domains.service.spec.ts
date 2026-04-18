import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { DomainsService } from './domains.service';
import type { DohLookupResult, DohService } from './doh.service';
import type { DomainsQueue } from './domains.queue';
import type { DomainVerification } from '../../database/entities/domain-verification.entity';
import type { Tenant } from '../../database/entities/tenant.entity';

function makeRepo<T extends { id: string }>(seed: T[] = []) {
  const rows = new Map<string, T>(seed.map((r) => [r.id, r]));
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
      rows.set(row.id, row);
      return row;
    },
    async count(opts: { where: Partial<T> }): Promise<number> {
      let n = 0;
      for (const r of rows.values()) {
        if (matches(r, opts.where)) n += 1;
      }
      return n;
    },
    async find(opts: { where: Partial<T> }): Promise<T[]> {
      const out: T[] = [];
      for (const r of rows.values()) if (matches(r, opts.where)) out.push(r);
      return out;
    },
    async findOne(opts: { where: Partial<T> }): Promise<T | null> {
      for (const r of rows.values()) if (matches(r, opts.where)) return r;
      return null;
    },
  };
}

function matches<T>(row: T, where: Partial<T>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if ((row as unknown as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

function makeDoh(result: DohLookupResult): DohService {
  return {
    lookupTxt: jest.fn().mockResolvedValue(result),
  } as unknown as DohService;
}

function makeQueue(): DomainsQueue {
  return {
    enqueueVerify: jest.fn().mockResolvedValue(undefined),
  } as unknown as DomainsQueue;
}

function build(
  opts: {
    ownerId?: string;
    customDomain?: string | null;
    verifications?: DomainVerification[];
    extraTenants?: Tenant[];
    doh?: DohService;
    queue?: DomainsQueue;
  } = {},
) {
  const tenant = {
    id: 't1',
    ownerId: opts.ownerId ?? 'u1',
    subdomain: 'alice',
    customDomain: opts.customDomain ?? null,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Tenant;
  const tenants = [tenant, ...(opts.extraTenants ?? [])];
  const tenantRepo = makeRepo<Tenant>(tenants);
  const verifyRepo = makeRepo<DomainVerification>(opts.verifications ?? []);
  const doh = opts.doh ?? makeDoh({ found: false, records: [] });
  const queue = opts.queue ?? makeQueue();
  const svc = new DomainsService(
    verifyRepo as unknown as Repository<DomainVerification>,
    tenantRepo as unknown as Repository<Tenant>,
    doh,
    queue,
  );
  return { svc, tenant, tenantRepo, verifyRepo, doh, queue };
}

describe('DomainsService', () => {
  it('403s when caller has no tenant', async () => {
    const { svc } = build({ ownerId: 'other' });
    await expect(svc.requestVerification('u1', 'alice.dev')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an existing pending row instead of creating a duplicate', async () => {
    const existing = {
      id: 'v1',
      tenantId: 't1',
      domain: 'alice.dev',
      token: 'tok',
      status: 'pending',
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: new Date(),
    } as unknown as DomainVerification;
    const { svc, verifyRepo } = build({ verifications: [existing] });
    const out = await svc.requestVerification('u1', 'alice.dev');
    expect(out.id).toBe('v1');
    expect(verifyRepo.rows.size).toBe(1);
  });

  it('409s when another tenant has already bound the domain', async () => {
    const other = {
      id: 't2',
      ownerId: 'u2',
      subdomain: 'bob',
      customDomain: 'alice.dev',
      status: 'published',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Tenant;
    const { svc } = build({ extraTenants: [other] });
    await expect(svc.requestVerification('u1', 'alice.dev')).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a fresh verification with a 32-hex token', async () => {
    const { svc } = build();
    const out = await svc.requestVerification('u1', 'alice.dev');
    expect(out.status).toBe('pending');
    expect(out.token).toMatch(/^[0-9a-f]{32}$/);
    expect(out.txtRecord).toBe('_portfoli.alice.dev');
    expect(out.txtValue).toBe(`portfoli-verify=${out.token}`);
  });

  it('verify: 404s if no pending row exists', async () => {
    const { svc } = build();
    await expect(svc.verify('u1', 'alice.dev')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verify succeeds when DoH returns the expected TXT and binds the domain', async () => {
    const row = {
      id: 'v1',
      tenantId: 't1',
      domain: 'alice.dev',
      token: 'abc',
      status: 'pending',
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: new Date(),
    } as unknown as DomainVerification;
    const { svc, tenantRepo } = build({
      verifications: [row],
      doh: makeDoh({ found: true, records: ['portfoli-verify=abc'] }),
    });
    const out = await svc.verify('u1', 'alice.dev');
    expect(out.status).toBe('verified');
    expect(out.boundToTenant).toBe(true);
    expect(tenantRepo.rows.get('t1')?.customDomain).toBe('alice.dev');
  });

  it('verify schedules a retry when DoH does not yet return the TXT', async () => {
    const row = {
      id: 'v1',
      tenantId: 't1',
      domain: 'alice.dev',
      token: 'abc',
      status: 'pending',
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: new Date(),
    } as unknown as DomainVerification;
    const queue = makeQueue();
    const { svc } = build({
      verifications: [row],
      doh: makeDoh({ found: false, records: [] }),
      queue,
    });
    const out = await svc.verify('u1', 'alice.dev');
    expect(out.status).toBe('pending');
    expect(queue.enqueueVerify).toHaveBeenCalledWith({ verificationId: 'v1' }, 60_000);
  });

  it('unbind clears tenant.customDomain', async () => {
    const { svc, tenantRepo } = build({ customDomain: 'alice.dev' });
    const out = await svc.unbind('u1');
    expect(out.unbound).toBe(true);
    expect(tenantRepo.rows.get('t1')?.customDomain).toBeNull();
  });
});
