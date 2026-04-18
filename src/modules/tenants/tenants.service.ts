import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'node:crypto';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { RESERVED_SUBDOMAINS } from './reserved-subdomains';

export interface TenantWithOwner {
  id: string;
  ownerId: string;
  subdomain: string;
  customDomain: string | null;
  status: Tenant['status'];
  createdAt: string;
  updatedAt: string;
  owner: { id: string; email: string; name: string };
}

const SUBDOMAIN_ADJECTIVES = [
  'bright',
  'nimble',
  'quiet',
  'brisk',
  'candid',
  'clever',
  'deft',
  'eager',
];

const SUBDOMAIN_NOUNS = [
  'otter',
  'falcon',
  'cedar',
  'river',
  'harbor',
  'meadow',
  'copper',
  'silver',
];

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Returns the caller's tenant, creating one on first access with a
   * unique auto-assigned subdomain. Idempotent by userId.
   */
  async getOrCreateForUser(userId: string): Promise<TenantWithOwner> {
    const existing = await this.tenants.findOne({ where: { ownerId: userId } });
    if (existing) return this.hydrate(existing);

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });

    const subdomain = await this.generateUniqueSubdomain();
    const row = this.tenants.create({
      ownerId: userId,
      subdomain,
      customDomain: null,
      status: 'draft',
    });
    try {
      await this.tenants.save(row);
    } catch (err) {
      // Race: another concurrent request created the tenant first. Re-fetch.
      const raced = await this.tenants.findOne({ where: { ownerId: userId } });
      if (raced) return this.hydrate(raced);
      throw err;
    }
    return this.hydrate(row, user);
  }

  /**
   * Changes the tenant's subdomain. Enforces regex (at DTO layer), the
   * reserved list, and DB-level uniqueness via a graceful 409 path.
   */
  async setSubdomain(userId: string, rawSubdomain: string): Promise<TenantWithOwner> {
    const subdomain = rawSubdomain.trim().toLowerCase();
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      throw new ConflictException({
        code: 'subdomain_reserved',
        message: 'That subdomain is reserved.',
      });
    }

    const tenant = await this.getOrCreateOwnRow(userId);
    if (tenant.subdomain === subdomain) return this.hydrate(tenant);

    const taken = await this.tenants.exist({ where: { subdomain } });
    if (taken) {
      throw new ConflictException({
        code: 'subdomain_taken',
        message: 'That subdomain is already in use.',
      });
    }

    tenant.subdomain = subdomain;
    try {
      await this.tenants.save(tenant);
    } catch {
      throw new ConflictException({
        code: 'subdomain_taken',
        message: 'That subdomain is already in use.',
      });
    }
    return this.hydrate(tenant);
  }

  private async getOrCreateOwnRow(userId: string): Promise<Tenant> {
    const existing = await this.tenants.findOne({ where: { ownerId: userId } });
    if (existing) return existing;
    // Triggers create path; hydrate is discarded here — we need the row.
    await this.getOrCreateForUser(userId);
    const row = await this.tenants.findOne({ where: { ownerId: userId } });
    if (!row) throw new NotFoundException({ code: 'tenant_missing', message: 'Tenant missing.' });
    return row;
  }

  /**
   * Picks an adjective-noun-NNNN slug and probes for uniqueness with a
   * small retry budget before giving up. Collisions are astronomically
   * unlikely at our scale — the retry is belt + braces.
   */
  private async generateUniqueSubdomain(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const adj = SUBDOMAIN_ADJECTIVES[randomInt(SUBDOMAIN_ADJECTIVES.length)]!;
      const noun = SUBDOMAIN_NOUNS[randomInt(SUBDOMAIN_NOUNS.length)]!;
      const num = randomInt(1000, 10_000);
      const candidate = `${adj}-${noun}-${num}`;
      if (RESERVED_SUBDOMAINS.has(candidate)) continue;
      const taken = await this.tenants.exist({ where: { subdomain: candidate } });
      if (!taken) return candidate;
    }
    throw new ConflictException({
      code: 'subdomain_generation_failed',
      message: 'Could not generate a unique subdomain. Please try again.',
    });
  }

  private async hydrate(tenant: Tenant, ownerHint?: User): Promise<TenantWithOwner> {
    const owner = ownerHint ?? (await this.users.findOne({ where: { id: tenant.ownerId } }));
    if (!owner) throw new NotFoundException({ code: 'owner_missing', message: 'Owner missing.' });
    return {
      id: tenant.id,
      ownerId: tenant.ownerId,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      owner: { id: owner.id, email: owner.email, name: owner.name },
    };
  }
}
