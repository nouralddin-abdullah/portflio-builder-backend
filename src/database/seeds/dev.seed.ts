import type { DataSource } from 'typeorm';
import { User } from '../entities/user.entity';
import { Tenant } from '../entities/tenant.entity';
import { Portfolio } from '../entities/portfolio.entity';

/**
 * Dev-only seed. Creates one demo user + tenant + portfolio so the editor
 * has something to load against localhost. Runs only when NODE_ENV === 'development'.
 */
export async function seedDev(dataSource: DataSource): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Seeds may only run in NODE_ENV=development.');
  }

  const users = dataSource.getRepository(User);
  const tenants = dataSource.getRepository(Tenant);
  const portfolios = dataSource.getRepository(Portfolio);

  const existing = await users.findOne({ where: { email: 'demo@portfoli.app' } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log('[seed] demo user already exists — skipping');
    return;
  }

  const user = users.create({
    email: 'demo@portfoli.app',
    passwordHash: null,
    name: 'Demo Owner',
    headline: 'Backend-seeded placeholder account',
    location: null,
    avatarUrl: null,
    emailVerifiedAt: new Date(),
  });
  await users.save(user);

  const tenant = tenants.create({
    ownerId: user.id,
    subdomain: 'demo',
    status: 'draft',
    customDomain: null,
  });
  await tenants.save(tenant);

  const portfolio = portfolios.create({
    tenantId: tenant.id,
    template: 'minimal',
    theme: 'ink',
    fontPair: 'editorial',
    enabledSections: ['hero', 'about'],
    draft: { hero: { title: 'Hi, I am Demo' } },
    published: null,
  });
  await portfolios.save(portfolio);

  // eslint-disable-next-line no-console
  console.log(`[seed] created demo user=${user.id} tenant=${tenant.id} portfolio=${portfolio.id}`);
}
