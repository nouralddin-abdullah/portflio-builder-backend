import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantOnboardedAt1713456200000 implements MigrationInterface {
  name = 'TenantOnboardedAt1713456200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tenants" ADD COLUMN "onboarded_at" timestamptz`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tenants" DROP COLUMN "onboarded_at"`);
  }
}
