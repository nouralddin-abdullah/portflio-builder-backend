import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

/**
 * Smoke test that TypeORM can parse every entity + its relations without
 * actually connecting to a DB. Catches missing decorators, circular metadata,
 * enum typos, and misnamed foreign keys at unit-test time.
 */
describe('AppDataSource metadata', () => {
  it('builds metadata for all entities', async () => {
    const ds = new DataSource({
      type: 'postgres',
      url: 'postgres://unused:unused@localhost:5432/unused',
      entities: [...ALL_ENTITIES],
      synchronize: false,
    });
    await ds.buildMetadatas();
    const names = ds.entityMetadatas.map((m) => m.tableName).sort();
    expect(names).toContain('users');
    expect(names).toContain('tenants');
    expect(names).toContain('portfolios');
    expect(names).toContain('portfolio_revisions');
    expect(names).toContain('assets');
    expect(names).toContain('inquiries');
    expect(names).toContain('page_views');
    expect(names).toContain('daily_stats');
    expect(ds.entityMetadatas).toHaveLength(ALL_ENTITIES.length);
  });

  it('uses snake_case for columns', async () => {
    const ds = new DataSource({
      type: 'postgres',
      url: 'postgres://unused:unused@localhost:5432/unused',
      entities: [...ALL_ENTITIES],
      synchronize: false,
    });
    await ds.buildMetadatas();
    const user = ds.entityMetadatas.find((m) => m.tableName === 'users');
    expect(user).toBeDefined();
    const createdAt = user!.columns.find((c) => c.propertyName === 'createdAt');
    expect(createdAt?.databaseName).toBe('created_at');
  });
});
