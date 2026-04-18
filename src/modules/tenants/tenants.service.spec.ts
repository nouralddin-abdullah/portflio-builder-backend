import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { TenantsService } from './tenants.service';
import type { Tenant } from '../../database/entities/tenant.entity';
import type { User } from '../../database/entities/user.entity';

function makeTenantRepo(seed: Tenant[] = []) {
  const rows = new Map<string, Tenant>(seed.map((t) => [t.id, t]));
  let counter = 0;
  const repo = {
    rows,
    create(data: Partial<Tenant>): Tenant {
      counter += 1;
      const now = new Date();
      return {
        id: `t_${counter}`,
        createdAt: now,
        updatedAt: now,
        ...data,
      } as Tenant;
    },
    async save(row: Tenant): Promise<Tenant> {
      for (const other of rows.values()) {
        if (other.id !== row.id && other.subdomain === row.subdomain) {
          throw new Error('unique_violation');
        }
      }
      row.updatedAt = new Date();
      rows.set(row.id, row);
      return row;
    },
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
    async exist(opts: { where: Partial<Tenant> }): Promise<boolean> {
      return (await repo.findOne(opts)) !== null;
    },
  };
  return repo;
}

function makeUserRepo(seed: User[] = []) {
  const rows = new Map<string, User>(seed.map((u) => [u.id, u]));
  return {
    async findOne(opts: { where: Partial<User> }): Promise<User | null> {
      for (const u of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((u as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return u;
      }
      return null;
    },
  };
}

function seedUser(): User {
  return {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
  } as User;
}

function build(tenantRepo: ReturnType<typeof makeTenantRepo>, userRepo: ReturnType<typeof makeUserRepo>) {
  return new TenantsService(
    tenantRepo as unknown as Repository<Tenant>,
    userRepo as unknown as Repository<User>,
  );
}

describe('TenantsService', () => {
  describe('getOrCreateForUser', () => {
    it('creates a tenant with a generated subdomain on first access', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      const out = await svc.getOrCreateForUser('u1');
      expect(out.ownerId).toBe('u1');
      expect(out.subdomain).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
      expect(tenants.rows.size).toBe(1);
    });

    it('is idempotent: second call returns the same tenant', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      const first = await svc.getOrCreateForUser('u1');
      const second = await svc.getOrCreateForUser('u1');
      expect(second.id).toBe(first.id);
      expect(tenants.rows.size).toBe(1);
    });

    it('hydrates with owner details', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      const out = await svc.getOrCreateForUser('u1');
      expect(out.owner).toEqual({ id: 'u1', email: 'alice@example.com', name: 'Alice' });
    });
  });

  describe('setSubdomain', () => {
    it('rejects reserved subdomains with 409', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      await expect(svc.setSubdomain('u1', 'admin')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a subdomain taken by another tenant', async () => {
      const tenants = makeTenantRepo([
        {
          id: 't_other',
          ownerId: 'u2',
          subdomain: 'taken-name',
          customDomain: null,
          status: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Tenant,
      ]);
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      await expect(svc.setSubdomain('u1', 'taken-name')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows the owner to re-set their current subdomain (no-op)', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      const created = await svc.getOrCreateForUser('u1');
      const out = await svc.setSubdomain('u1', created.subdomain);
      expect(out.subdomain).toBe(created.subdomain);
    });

    it('updates the subdomain when valid and available', async () => {
      const tenants = makeTenantRepo();
      const users = makeUserRepo([seedUser()]);
      const svc = build(tenants, users);
      await svc.getOrCreateForUser('u1');
      const out = await svc.setSubdomain('u1', 'my-cool-handle');
      expect(out.subdomain).toBe('my-cool-handle');
    });
  });
});
