import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables row-level security on tenant-scoped tables. Policies gate every
 * SELECT/INSERT/UPDATE/DELETE on a match between the row's tenant (or owner)
 * and the request-scoped GUC `app.user_id` / `app.tenant_id`.
 *
 * The app sets these via `SET LOCAL` inside a per-request transaction; raw
 * connections (migrations, cron workers) run as the DB superuser which BYPASSes
 * RLS, so they remain operational.
 *
 * RLS is a defense-in-depth layer — every service method MUST still include
 * `WHERE tenant_id = ?` or `WHERE owner_id = ?` as the first line of defense.
 */
export class RowLevelSecurity1713456100000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // A stable current_user_id() that reads the GUC. NULL when unset so that
    // policy matches fail closed — nothing leaks when a caller forgets to set it.
    await q.query(`
      CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS varchar(24)
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::varchar(24)
      $$;
    `);
    await q.query(`
      CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS varchar(24)
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.tenant_id', true), '')::varchar(24)
      $$;
    `);

    // Helper to resolve tenant_id → owner_id without recursion.
    await q.query(`
      CREATE OR REPLACE FUNCTION app_tenant_owner(tid varchar(24)) RETURNS varchar(24)
      LANGUAGE sql STABLE AS $$
        SELECT owner_id FROM tenants WHERE id = tid
      $$;
    `);

    const enable = async (table: string, using: string) => {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY "${table}_owner" ON "${table}"
        USING (${using})
        WITH CHECK (${using})
      `);
    };

    await enable('tenants', 'owner_id = app_current_user_id()');
    await enable('portfolios', 'app_tenant_owner(tenant_id) = app_current_user_id()');
    await enable(
      'portfolio_revisions',
      'app_tenant_owner((SELECT tenant_id FROM portfolios WHERE id = portfolio_id)) = app_current_user_id()',
    );
    await enable('assets', 'owner_id = app_current_user_id()');
    await enable('inquiries', 'app_tenant_owner(tenant_id) = app_current_user_id()');
    await enable('domain_verifications', 'app_tenant_owner(tenant_id) = app_current_user_id()');
    await enable('page_views', 'app_tenant_owner(tenant_id) = app_current_user_id()');
    await enable('daily_stats', 'app_tenant_owner(tenant_id) = app_current_user_id()');
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'daily_stats',
      'page_views',
      'domain_verifications',
      'inquiries',
      'assets',
      'portfolio_revisions',
      'portfolios',
      'tenants',
    ]) {
      await q.query(`DROP POLICY IF EXISTS "${table}_owner" ON "${table}"`);
      await q.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await q.query(`DROP FUNCTION IF EXISTS app_tenant_owner(varchar)`);
    await q.query(`DROP FUNCTION IF EXISTS app_current_tenant_id()`);
    await q.query(`DROP FUNCTION IF EXISTS app_current_user_id()`);
  }
}
