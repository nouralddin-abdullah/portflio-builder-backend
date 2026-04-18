import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1713456000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // --- enums -------------------------------------------------------------
    await q.query(`CREATE TYPE "oauth_provider" AS ENUM('google', 'github')`);
    await q.query(`CREATE TYPE "verification_purpose" AS ENUM('email_verify', 'email_change')`);
    await q.query(`CREATE TYPE "publish_status" AS ENUM('draft', 'published', 'archived')`);
    await q.query(
      `CREATE TYPE "template_id" AS ENUM('minimal', 'dev-log', 'compass', 'batman', 'spiderman')`,
    );
    await q.query(`CREATE TYPE "theme_id" AS ENUM('ink', 'warm', 'cool', 'paper')`);
    await q.query(
      `CREATE TYPE "font_pair_id" AS ENUM('editorial', 'technical', 'humanist', 'brutal')`,
    );
    await q.query(
      `CREATE TYPE "domain_verification_status" AS ENUM('pending', 'verified', 'failed')`,
    );

    // --- users -------------------------------------------------------------
    await q.query(`
      CREATE TABLE "users" (
        "id" varchar(24) PRIMARY KEY,
        "email" varchar NOT NULL,
        "email_verified_at" timestamptz,
        "password_hash" text,
        "name" varchar NOT NULL,
        "avatar_url" text,
        "headline" text,
        "location" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);
    await q.query(`CREATE INDEX "ix_users_email" ON "users" ("email")`);

    // --- sessions ----------------------------------------------------------
    await q.query(`
      CREATE TABLE "sessions" (
        "id" varchar(24) PRIMARY KEY,
        "user_id" varchar(24) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar NOT NULL,
        "user_agent" text,
        "ip" inet,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by_id" varchar(24),
        CONSTRAINT "uq_sessions_token_hash" UNIQUE ("token_hash")
      )
    `);
    await q.query(`CREATE INDEX "ix_sessions_user_id" ON "sessions" ("user_id")`);
    await q.query(`CREATE INDEX "ix_sessions_expires_at" ON "sessions" ("expires_at")`);

    // --- oauth_accounts ----------------------------------------------------
    await q.query(`
      CREATE TABLE "oauth_accounts" (
        "id" varchar(24) PRIMARY KEY,
        "user_id" varchar(24) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "provider" "oauth_provider" NOT NULL,
        "provider_uid" varchar NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_oauth_accounts_provider" UNIQUE ("provider", "provider_uid")
      )
    `);
    await q.query(`CREATE INDEX "ix_oauth_accounts_user_id" ON "oauth_accounts" ("user_id")`);

    // --- verification_tokens ----------------------------------------------
    await q.query(`
      CREATE TABLE "verification_tokens" (
        "id" varchar(24) PRIMARY KEY,
        "user_id" varchar(24) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar NOT NULL,
        "purpose" "verification_purpose" NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_verification_tokens_hash" UNIQUE ("token_hash")
      )
    `);
    await q.query(
      `CREATE INDEX "ix_verification_tokens_user_purpose" ON "verification_tokens" ("user_id", "purpose")`,
    );

    // --- password_reset_tokens --------------------------------------------
    await q.query(`
      CREATE TABLE "password_reset_tokens" (
        "id" varchar(24) PRIMARY KEY,
        "user_id" varchar(24) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_password_reset_tokens_hash" UNIQUE ("token_hash")
      )
    `);
    await q.query(
      `CREATE INDEX "ix_password_reset_tokens_user" ON "password_reset_tokens" ("user_id")`,
    );

    // --- tenants -----------------------------------------------------------
    await q.query(`
      CREATE TABLE "tenants" (
        "id" varchar(24) PRIMARY KEY,
        "owner_id" varchar(24) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "subdomain" varchar NOT NULL,
        "custom_domain" varchar,
        "status" "publish_status" NOT NULL DEFAULT 'draft',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_tenants_owner" UNIQUE ("owner_id"),
        CONSTRAINT "uq_tenants_subdomain" UNIQUE ("subdomain"),
        CONSTRAINT "uq_tenants_custom_domain" UNIQUE ("custom_domain")
      )
    `);
    await q.query(`CREATE INDEX "ix_tenants_subdomain" ON "tenants" ("subdomain")`);
    await q.query(`CREATE INDEX "ix_tenants_custom_domain" ON "tenants" ("custom_domain")`);

    // --- portfolios --------------------------------------------------------
    await q.query(`
      CREATE TABLE "portfolios" (
        "id" varchar(24) PRIMARY KEY,
        "tenant_id" varchar(24) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "template" "template_id" NOT NULL DEFAULT 'minimal',
        "theme" "theme_id" NOT NULL DEFAULT 'ink',
        "font_pair" "font_pair_id" NOT NULL DEFAULT 'editorial',
        "enabled_sections" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "draft" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "published" jsonb,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_portfolios_tenant" UNIQUE ("tenant_id")
      )
    `);

    // --- portfolio_revisions ----------------------------------------------
    await q.query(`
      CREATE TABLE "portfolio_revisions" (
        "id" varchar(24) PRIMARY KEY,
        "portfolio_id" varchar(24) NOT NULL REFERENCES "portfolios"("id") ON DELETE CASCADE,
        "snapshot" jsonb NOT NULL,
        "published_at" timestamptz NOT NULL DEFAULT now(),
        "published_by" varchar(24) NOT NULL
      )
    `);
    await q.query(
      `CREATE INDEX "ix_portfolio_revisions_portfolio" ON "portfolio_revisions" ("portfolio_id", "published_at")`,
    );

    // --- assets ------------------------------------------------------------
    await q.query(`
      CREATE TABLE "assets" (
        "id" varchar(24) PRIMARY KEY,
        "portfolio_id" varchar(24) NOT NULL REFERENCES "portfolios"("id") ON DELETE CASCADE,
        "owner_id" varchar(24) NOT NULL,
        "key" varchar NOT NULL,
        "url" text NOT NULL,
        "mime" varchar NOT NULL,
        "byte_size" integer NOT NULL,
        "width" integer,
        "height" integer,
        "derivatives" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "uq_assets_key" UNIQUE ("key")
      )
    `);
    await q.query(`CREATE INDEX "ix_assets_portfolio" ON "assets" ("portfolio_id")`);
    await q.query(`CREATE INDEX "ix_assets_owner" ON "assets" ("owner_id")`);

    // --- domain_verifications ---------------------------------------------
    await q.query(`
      CREATE TABLE "domain_verifications" (
        "id" varchar(24) PRIMARY KEY,
        "tenant_id" varchar(24) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "domain" varchar NOT NULL,
        "token" varchar NOT NULL,
        "status" "domain_verification_status" NOT NULL DEFAULT 'pending',
        "last_checked_at" timestamptz,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_domain_verifications_tenant_domain" UNIQUE ("tenant_id", "domain")
      )
    `);

    // --- inquiries ---------------------------------------------------------
    await q.query(`
      CREATE TABLE "inquiries" (
        "id" varchar(24) PRIMARY KEY,
        "tenant_id" varchar(24) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "name" varchar NOT NULL,
        "email" varchar NOT NULL,
        "subject" text,
        "body" text NOT NULL,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_inquiries_tenant_created" ON "inquiries" ("tenant_id", "created_at")`,
    );

    // --- page_views --------------------------------------------------------
    await q.query(`
      CREATE TABLE "page_views" (
        "id" bigserial PRIMARY KEY,
        "tenant_id" varchar(24) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "path" varchar NOT NULL,
        "referrer" text,
        "country" varchar(2),
        "device" varchar(16),
        "session_hash" varchar NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX "ix_page_views_tenant_created" ON "page_views" ("tenant_id", "created_at")`,
    );

    // --- daily_stats -------------------------------------------------------
    await q.query(`
      CREATE TABLE "daily_stats" (
        "tenant_id" varchar(24) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "date" date NOT NULL,
        "views" integer NOT NULL DEFAULT 0,
        "uniques" integer NOT NULL DEFAULT 0,
        "top_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY ("tenant_id", "date")
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "daily_stats"`);
    await q.query(`DROP TABLE IF EXISTS "page_views"`);
    await q.query(`DROP TABLE IF EXISTS "inquiries"`);
    await q.query(`DROP TABLE IF EXISTS "domain_verifications"`);
    await q.query(`DROP TABLE IF EXISTS "assets"`);
    await q.query(`DROP TABLE IF EXISTS "portfolio_revisions"`);
    await q.query(`DROP TABLE IF EXISTS "portfolios"`);
    await q.query(`DROP TABLE IF EXISTS "tenants"`);
    await q.query(`DROP TABLE IF EXISTS "password_reset_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "verification_tokens"`);
    await q.query(`DROP TABLE IF EXISTS "oauth_accounts"`);
    await q.query(`DROP TABLE IF EXISTS "sessions"`);
    await q.query(`DROP TABLE IF EXISTS "users"`);

    await q.query(`DROP TYPE IF EXISTS "domain_verification_status"`);
    await q.query(`DROP TYPE IF EXISTS "font_pair_id"`);
    await q.query(`DROP TYPE IF EXISTS "theme_id"`);
    await q.query(`DROP TYPE IF EXISTS "template_id"`);
    await q.query(`DROP TYPE IF EXISTS "publish_status"`);
    await q.query(`DROP TYPE IF EXISTS "verification_purpose"`);
    await q.query(`DROP TYPE IF EXISTS "oauth_provider"`);
  }
}
