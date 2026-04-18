**UP NOTE: DO A SWAGGER API DOC PAGE TOO FOR OWNER CAN TEST IT**

# Portfoli — Backend Agent Brief

You are the engineering agent responsible for designing, building, and maintaining the backend for **Portfoli**, a multi-tenant portfolio builder. This document is your complete spec. Read it end-to-end before writing any code. When in doubt, re-read the relevant section rather than guess. Ask the human only when a requirement is genuinely ambiguous and the answer is not here.

---

## 0. Non-negotiables

1. **Portfoli is 100% free forever.** There are no paid tiers, no subscription flows, no upgrade CTAs, no billing code, no Stripe, no "pro" feature gates. Do not add any field, table, endpoint, or flag that represents pricing/billing/plan state. If you see one in an older branch, remove it.
2. **The frontend contract in `src/types/portfolio.ts` is the source of truth.** The backend serves a flat config payload (`PortfolioConfig`) of state flags + scalars. It never ships a dynamic component tree. Any DB model must serialize cleanly to this shape.
3. **Multi-tenant isolation is non-negotiable.** Every query that touches tenant-scoped data must include `tenantId` (or ownerId) in its `WHERE` clause. Row-level security (RLS) is the second line of defense — the first line is always the query.
4. **Never commit secrets.** All keys come from env vars loaded via `@nestjs/config`. `.env.example` is committed; `.env` is not.
5. **Root causes only.** If a test is flaky, fix the race. If a type is wrong, fix the model. Do not swallow errors, downgrade types to `any`, or add `// @ts-ignore` to move on.

---

## 1. Product context

Portfoli lets a user sign up, pick a template (`minimal | dev-log | compass | batman | spiderman`), fill in six sections (hero, about, projects, experience, education, contact), and publish to `{subdomain}.portfoli.app` or a custom domain. The editor is a React SPA (this repo). The backend's job is:

- Auth (email+password, OAuth: Google, GitHub).
- Store and serve the portfolio config.
- Host uploaded images (portraits, project covers).
- Serve the published config to the render layer at `{subdomain}.portfoli.app` (and custom domains).
- Accept inquiries from contact forms and email them to the owner.
- Record lightweight, privacy-respecting analytics.

---

## 2. Stack

| Layer                       | Choice                                                            | Why                                                           |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Runtime                     | Node.js 22 LTS                                                    | Native `fetch`, stable perf                                   |
| Framework                   | **NestJS 10** (Express adapter)                                   | Module boundaries, DI, guards, pipes                          |
| Language                    | TypeScript 5.x strict                                             | No `any`, no implicit any                                     |
| DB                          | **PostgreSQL 16**                                                 | JSONB for section bodies, RLS, full text                      |
| ORM                         | **TypeORM 0.3**                                                   | Decorated entities, migrations, QueryBuilder for hot paths    |
| Cache / rate limit / queues | **Redis 7**                                                       | `ioredis` client                                              |
| Jobs                        | **BullMQ** on Redis                                               | Publish, email send, analytics rollups                        |
| File storage                | **Cloudflare R2** (S3-compatible API)                             | Zero egress fees, pre-signed uploads via `@aws-sdk/client-s3` |
| Mail                        | **Resend** (primary), SMTP fallback                               | Inquiry relay, verification, password reset                   |
| Auth tokens                 | JWT (access, 15 min) + opaque refresh (30 d, DB-backed, rotating) | Access is stateless; refresh is revocable                     |
| Validation                  | **zod** — the one validator for DTOs, env, and shared contracts   | Same schemas the frontend uses (re-export, don't re-declare)  |
| Logging                     | `pino` + `nestjs-pino`                                            | JSON logs, request IDs                                        |
| Errors                      | Sentry                                                            | Unhandled + tagged                                            |
| Tests                       | Jest (unit), Supertest (e2e), Testcontainers (Postgres + Redis)   | Real DB in e2e                                                |
| Lint/format                 | ESLint (flat config) + Prettier                                   | Enforced in CI                                                |
| Container                   | Docker + docker-compose (dev), Dockerfile (prod)                  | Reproducible                                                  |
| Deploy                      | Fly.io or Railway (pick one and stick to it)                      | Region-pinned Postgres                                        |

---

## 3. Repo layout

The backend lives in a separate repo, `portfoli-backend`. Layout:

```
portfoli-backend/
  src/
    main.ts                      # bootstrap
    app.module.ts
    config/                      # env schema, typed config provider
      env.schema.ts
      config.module.ts
    common/                      # framework-level cross-cutting
      filters/                   # exception filters
      interceptors/              # logging, timing, serialization
      guards/                    # JwtAuthGuard, TenantOwnerGuard
      pipes/                     # ZodValidationPipe
      decorators/                # @CurrentUser(), @TenantId()
      types/
    modules/
      auth/
      users/
      tenants/
      portfolios/                # config CRUD + publish
      sections/                  # hero/about/projects/...
      assets/                    # uploads + pre-signed URLs
      domains/                   # custom domain verification
      inquiries/                 # contact-form submissions
      analytics/                 # ingest + rollups
      public/                    # read-only endpoints for the render layer
      health/                    # /healthz /readyz
    database/
      data-source.ts             # TypeORM DataSource (used by CLI + app)
      typeorm.module.ts          # TypeOrmModule.forRootAsync + feature reg
      entities/                  # *.entity.ts — one per table
      migrations/                # generated + hand-written
      subscribers/               # e.g. timestamp hooks, soft-delete hooks
      seeds/                     # dev-only seed scripts
    queue/
      index.ts                   # bull queue registrations
      processors/
    mail/
      templates/                 # MJML
      mail.service.ts
    storage/
      r2.service.ts              # pre-signed URLs, head, delete
  test/
    e2e/
    fixtures/
    utils/
  Dockerfile
  docker-compose.dev.yml
  .env.example
  package.json
  tsconfig.json
```

Each `module/` folder contains: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `schemas.ts` (zod), `*.spec.ts`, `*.e2e-spec.ts`. Services hold business logic; controllers are thin; DTOs come from zod schemas via `z.infer`. TypeORM entities live in `database/entities/` — services inject repositories via `@InjectRepository(Entity)`.

---

## 4. Data model (TypeORM)

Entities live in `src/database/entities/`. One entity per table, one file per entity. Columns below are the authoritative list — do not add fields without updating this doc first.

### 4.1 Config conventions

- **Naming:** entity class `User`, table name `users` (use `@Entity({ name: 'users' })`). Column names snake_case via `@Column({ name: 'created_at' })` — TS properties stay camelCase.
- **IDs:** cuid2 (`@paralleldrive/cuid2`) generated in `BeforeInsert` hooks, column type `varchar(24)` primary key. No UUIDs.
- **Timestamps:** every table has `createdAt` (`@CreateDateColumn`) and `updatedAt` (`@UpdateDateColumn`). Soft deletes only where explicitly stated — TypeORM's `@DeleteDateColumn` on `Asset` only.
- **Enums:** PostgreSQL native enums via `@Column({ type: 'enum', enum: X })`. The enum TS values must match the frontend's union literals lowercase (`'minimal'`, `'dev-log'`, etc.) — do not upper-snake-case them; the frontend expects the raw strings.
- **Relations:** always declare both sides. Always set `onDelete: 'CASCADE'` on owning foreign keys where the child can't exist without the parent.
- **JSON:** use `jsonb` (`@Column({ type: 'jsonb' })`) for section bodies and meta.

### 4.2 Entities

```ts
// users.entity.ts
@Entity({ name: "users" })
@Index(["email"])
export class User {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ unique: true }) email!: string;
  @Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
  emailVerifiedAt!: Date | null;
  @Column({ name: "password_hash", type: "text", nullable: true })
  passwordHash!: string | null; // null if OAuth-only
  @Column() name!: string;
  @Column({ name: "avatar_url", type: "text", nullable: true }) avatarUrl!:
    | string
    | null;
  @Column({ type: "text", nullable: true }) headline!: string | null;
  @Column({ type: "text", nullable: true }) location!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (t) => t.owner) tenant?: Tenant;
  @OneToMany(() => Session, (s) => s.user) sessions!: Session[];
  @OneToMany(() => OAuthAccount, (o) => o.user) oauthAccounts!: OAuthAccount[];

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// sessions.entity.ts — refresh-token backed
@Entity({ name: "sessions" })
@Index(["userId"])
@Index(["expiresAt"])
export class Session {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "user_id" }) userId!: string;
  @Column({ name: "token_hash", unique: true }) tokenHash!: string; // sha256(refreshToken)
  @Column({ name: "user_agent", type: "text", nullable: true }) userAgent!:
    | string
    | null;
  @Column({ type: "inet", nullable: true }) ip!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;
  @Column({
    name: "replaced_by_id",
    type: "varchar",
    length: 24,
    nullable: true,
  })
  replacedById!: string | null;

  @ManyToOne(() => User, (u) => u.sessions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// oauth-accounts.entity.ts
export type OAuthProvider = "google" | "github";

@Entity({ name: "oauth_accounts" })
@Unique(["provider", "providerUid"])
@Index(["userId"])
export class OAuthAccount {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "user_id" }) userId!: string;
  @Column({ type: "enum", enum: ["google", "github"] as const })
  provider!: OAuthProvider;
  @Column({ name: "provider_uid" }) providerUid!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => User, (u) => u.oauthAccounts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// verification-tokens.entity.ts
export type VerificationPurpose = "email_verify" | "email_change";

@Entity({ name: "verification_tokens" })
@Index(["userId", "purpose"])
export class VerificationToken {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "user_id" }) userId!: string;
  @Column({ name: "token_hash", unique: true }) tokenHash!: string;
  @Column({ type: "enum", enum: ["email_verify", "email_change"] as const })
  purpose!: VerificationPurpose;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "used_at", type: "timestamptz", nullable: true })
  usedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// password-reset-tokens.entity.ts — same shape as VerificationToken minus purpose.

// tenants.entity.ts
export type PublishStatus = "draft" | "published" | "archived";

@Entity({ name: "tenants" })
@Index(["subdomain"])
@Index(["customDomain"])
export class Tenant {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "owner_id", unique: true }) ownerId!: string;
  @Column({ unique: true }) subdomain!: string; // ^[a-z0-9-]{3,32}$
  @Column({ name: "custom_domain", unique: true, nullable: true })
  customDomain!: string | null;
  @Column({
    type: "enum",
    enum: ["draft", "published", "archived"] as const,
    default: "draft",
  })
  status!: PublishStatus;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => User, (u) => u.tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_id" })
  owner!: User;
  @OneToOne(() => Portfolio, (p) => p.tenant) portfolio?: Portfolio;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// portfolios.entity.ts
export type TemplateId =
  | "minimal"
  | "dev-log"
  | "compass"
  | "batman"
  | "spiderman";
export type ThemeId = "ink" | "warm" | "cool" | "paper";
export type FontPairId = "editorial" | "technical" | "humanist" | "brutal";

@Entity({ name: "portfolios" })
export class Portfolio {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "tenant_id", unique: true }) tenantId!: string;
  @Column({
    type: "enum",
    enum: ["minimal", "dev-log", "compass", "batman", "spiderman"] as const,
    default: "minimal",
  })
  template!: TemplateId;
  @Column({
    type: "enum",
    enum: ["ink", "warm", "cool", "paper"] as const,
    default: "ink",
  })
  theme!: ThemeId;
  @Column({
    name: "font_pair",
    type: "enum",
    enum: ["editorial", "technical", "humanist", "brutal"] as const,
    default: "editorial",
  })
  fontPair!: FontPairId;
  @Column({
    name: "enabled_sections",
    type: "text",
    array: true,
    default: () => "ARRAY[]::text[]",
  })
  enabledSections!: string[];
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  draft!: Record<string, unknown>;
  @Column({ type: "jsonb", nullable: true })
  published!: Record<string, unknown> | null;
  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => Tenant, (t) => t.portfolio, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// portfolio-revisions.entity.ts — append-only publish history
@Entity({ name: "portfolio_revisions" })
@Index(["portfolioId", "publishedAt"])
export class PortfolioRevision {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "portfolio_id" }) portfolioId!: string;
  @Column({ type: "jsonb" }) snapshot!: Record<string, unknown>;
  @CreateDateColumn({ name: "published_at", type: "timestamptz" })
  publishedAt!: Date;
  @Column({ name: "published_by" }) publishedBy!: string; // userId

  @ManyToOne(() => Portfolio, { onDelete: "CASCADE" })
  @JoinColumn({ name: "portfolio_id" })
  portfolio!: Portfolio;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// assets.entity.ts — R2 objects
@Entity({ name: "assets" })
@Index(["portfolioId"])
@Index(["ownerId"])
export class Asset {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "portfolio_id" }) portfolioId!: string;
  @Column({ name: "owner_id" }) ownerId!: string; // denormalized for scoping
  @Column({ unique: true }) key!: string; // R2 object key
  @Column({ type: "text" }) url!: string; // public CDN URL
  @Column() mime!: string;
  @Column({ name: "byte_size", type: "integer" }) byteSize!: number;
  @Column({ type: "integer", nullable: true }) width!: number | null;
  @Column({ type: "integer", nullable: true }) height!: number | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => Portfolio, { onDelete: "CASCADE" })
  @JoinColumn({ name: "portfolio_id" })
  portfolio!: Portfolio;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// domain-verifications.entity.ts
export type DomainVerificationStatus = "pending" | "verified" | "failed";

@Entity({ name: "domain_verifications" })
@Unique(["tenantId", "domain"])
export class DomainVerification {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "tenant_id" }) tenantId!: string;
  @Column() domain!: string;
  @Column() token!: string; // TXT record value
  @Column({
    type: "enum",
    enum: ["pending", "verified", "failed"] as const,
    default: "pending",
  })
  status!: DomainVerificationStatus;
  @Column({ name: "last_checked_at", type: "timestamptz", nullable: true })
  lastCheckedAt!: Date | null;
  @Column({ name: "verified_at", type: "timestamptz", nullable: true })
  verifiedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// inquiries.entity.ts
@Entity({ name: "inquiries" })
@Index(["tenantId", "createdAt"])
export class Inquiry {
  @PrimaryColumn({ type: "varchar", length: 24 }) id!: string;
  @Column({ name: "tenant_id" }) tenantId!: string;
  @Column() name!: string;
  @Column() email!: string;
  @Column({ type: "text", nullable: true }) subject!: string | null;
  @Column({ type: "text" }) body!: string;
  @Column({ type: "jsonb" }) meta!: {
    ip?: string;
    userAgent?: string;
    referrer?: string;
  };
  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;

  @BeforeInsert() assignId() {
    if (!this.id) this.id = createId();
  }
}

// page-views.entity.ts — privacy-respecting counter
@Entity({ name: "page_views" })
@Index(["tenantId", "createdAt"])
export class PageView {
  @PrimaryGeneratedColumn({ type: "bigint" }) id!: string; // bigint -> string
  @Column({ name: "tenant_id" }) tenantId!: string;
  @Column() path!: string;
  @Column({ type: "text", nullable: true }) referrer!: string | null;
  @Column({ type: "varchar", length: 2, nullable: true }) country!:
    | string
    | null; // ISO-2 from edge
  @Column({ type: "varchar", length: 16, nullable: true }) device!:
    | string
    | null; // 'mobile'|'tablet'|'desktop'
  @Column({ name: "session_hash" }) sessionHash!: string; // daily-rotating, salted
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;
}

// daily-stats.entity.ts — rolled up nightly; composite PK
@Entity({ name: "daily_stats" })
export class DailyStat {
  @PrimaryColumn({ name: "tenant_id" }) tenantId!: string;
  @PrimaryColumn({ type: "date" }) date!: string; // 'YYYY-MM-DD'
  @Column({ type: "integer", default: 0 }) views!: number;
  @Column({ type: "integer", default: 0 }) uniques!: number;
  @Column({ name: "top_paths", type: "jsonb", default: () => "'[]'::jsonb" })
  topPaths!: Array<{ path: string; count: number }>;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;
}
```

### 4.3 DataSource & module wiring

```ts
// src/database/data-source.ts
import "reflect-metadata";
import { DataSource } from "typeorm";
// ...imports...

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [__dirname + "/entities/*.entity.{ts,js}"],
  migrations: [__dirname + "/migrations/*.{ts,js}"],
  migrationsRun: false, // never in app; always via CLI
  synchronize: false, // NEVER true, not even in dev
  logging: ["error", "warn"],
  extra: { max: 10, connectionTimeoutMillis: 5000 },
});
```

The Nest module calls `TypeOrmModule.forRoot({ ...AppDataSource.options })` so the CLI and the app read the same config.

### 4.4 Migrations

- **No `synchronize: true` anywhere, ever** — not in dev, not in tests. Use the CLI: `pnpm typeorm migration:generate src/database/migrations/<name>` after changing an entity, then `pnpm typeorm migration:run`.
- Generated migrations are the starting point — review and edit before committing (TypeORM sometimes produces noisy diffs for defaults/orderings).
- Never edit a committed migration. Always create a new one.
- Destructive changes (drop column, rename table) go through a two-release expand/contract: add new → backfill → switch reads → stop writes → drop.
- Seeds live in `src/database/seeds/*.seed.ts` and only run when `NODE_ENV === 'development'`. They create one demo tenant + portfolio for local dev.
- Tests never run migrations in-process — Testcontainers boots a fresh Postgres and the test setup executes `AppDataSource.runMigrations()` once before the suite.

### Row-level security

Enable RLS on `tenants`, `portfolios`, `assets`, `inquiries`, `page_views`, `daily_stats`. The app sets `SET LOCAL app.user_id = '<userId>'` at the start of each request via a TypeORM `QueryRunner` acquired in a per-request interceptor; RLS policies check ownership against that GUC. This is a belt — the braces are always-included `WHERE tenant_id = ?` in every query. Because TypeORM's default connection behavior pools connections, always use `DataSource.transaction()` or an explicit `QueryRunner` when setting the GUC so it's scoped to that connection.

---

## 5. Shared contract

The frontend consumes `PortfolioConfig` (see `src/types/portfolio.ts`). The backend's job is to produce that shape. The field-level validation schemas live in `src/features/editor/schemas.ts` (hero, about, projects, experience, education, contact). **Copy those zod schemas into the backend verbatim, then publish them from a shared workspace package (`@portfoli/contracts`) so the frontend and backend stay in lockstep.** Section bodies validate against the same schemas the editor uses — there is no second, backend-only copy that can drift.

Zod is the one validator used throughout the backend:

- **DTOs** — every controller input is parsed through a `ZodValidationPipe`. `z.infer<typeof schema>` is the DTO type; there are no class-validator decorators.
- **Env config** — `env.schema.ts` is a zod schema; boot fails loudly if any var is missing or malformed.
- **Queue payloads** — BullMQ job data is parsed on enqueue _and_ re-parsed inside the processor. Jobs are untrusted input until validated.
- **External responses** — DNS lookups, OAuth user info, and similar are parsed through zod before being trusted.

The `portfolios.draft` JSONB column stores `{ hero?, about?, projects?, experience?, education?, contact? }` shaped exactly as `PreviewDraft`. `portfolios.published` stores the last snapshot promoted via `POST /api/portfolio/publish`. On write, the backend parses the incoming section body with the corresponding zod schema and also re-parses the full combined draft before persisting — this guarantees the column contents always match the shared contract.

---

## 6. API surface

All endpoints are JSON, prefixed `/api`, versioned implicitly (breaking changes cut a new path). All write endpoints require `Authorization: Bearer <accessToken>` except auth/public.

Responses follow: `{ data: T }` on success, `{ error: { code, message, details? } }` on failure. Validation errors return HTTP 422 with `details` as a flat map of `{ fieldPath: message }`.

### 6.1 Auth — `/api/auth`

| Method | Path                        | Body                        | Notes                                                                                     |
| ------ | --------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/register`                 | `{ email, password, name }` | Creates user + sends verify email. Returns tokens.                                        |
| POST   | `/login`                    | `{ email, password }`       | Returns `{ accessToken, refreshToken, user }`.                                            |
| POST   | `/refresh`                  | `{ refreshToken }`          | Rotates. Old token revoked immediately. Reuse detection → revoke the whole session chain. |
| POST   | `/logout`                   | `{ refreshToken }`          | Revokes session.                                                                          |
| POST   | `/verify-email`             | `{ token }`                 | Marks `emailVerified`.                                                                    |
| POST   | `/request-password-reset`   | `{ email }`                 | Always 204, even if unknown email.                                                        |
| POST   | `/reset-password`           | `{ token, password }`       | Revokes all sessions on success.                                                          |
| GET    | `/oauth/:provider`          | —                           | Redirect to provider.                                                                     |
| GET    | `/oauth/:provider/callback` | —                           | Exchange code → create/link account → redirect to app with one-time code.                 |
| POST   | `/oauth/exchange`           | `{ code }`                  | Swap one-time code for tokens.                                                            |

Passwords: argon2id, `memoryCost=19456`, `timeCost=2`, `parallelism=1`. Minimum length 10, rejected against a compiled `zxcvbn` score < 2 and against the top-10k common-passwords list.

Access tokens: RS256 JWT, `kid` from a rotating key ring (new key every 30 d, old key honored for 7 d after rotation). Claims: `sub`, `iat`, `exp`, `sid` (session id, for revocation tracing).

Refresh tokens: opaque 256-bit random, hashed with sha256 before persisting. Rotating (each refresh issues a new token and revokes the old). Reuse of a revoked refresh token → revoke the whole chain + security alert email.

### 6.2 Users — `/api/users`

| Method | Path               | Body                   | Notes                                                 |
| ------ | ------------------ | ---------------------- | ----------------------------------------------------- |
| GET    | `/me`              | —                      | Returns full `UserProfile`.                           |
| PATCH  | `/me`              | `Partial<UserProfile>` | Name, headline, avatarUrl, location.                  |
| POST   | `/me/email-change` | `{ newEmail }`         | Sends verification to new email.                      |
| POST   | `/me/password`     | `{ current, next }`    | Revokes all other sessions.                           |
| DELETE | `/me`              | `{ password }`         | Cascades: Tenant → Portfolio → Assets (S3 purge job). |

### 6.3 Tenant — `/api/tenant`

Exactly one tenant per user. Created on first access if missing.

| Method | Path                    | Body            | Notes                                                        |
| ------ | ----------------------- | --------------- | ------------------------------------------------------------ |
| GET    | `/`                     | —               | Returns tenant + owner.                                      |
| POST   | `/subdomain`            | `{ subdomain }` | Validates regex + reserved list + uniqueness.                |
| POST   | `/custom-domain`        | `{ domain }`    | Creates `DomainVerification` row, returns TXT record to add. |
| POST   | `/custom-domain/verify` | —               | Triggers DNS check job, returns current status.              |
| DELETE | `/custom-domain`        | —               | Unbinds.                                                     |

Reserved subdomains: `www`, `api`, `app`, `admin`, `docs`, `blog`, `status`, `help`, `mail`, `static`, `cdn`, `public`, plus a list in `reserved-subdomains.txt`.

### 6.4 Portfolio — `/api/portfolio`

| Method | Path                     | Body                                                 | Notes                                                                                                                                                |
| ------ | ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                      | —                                                    | Returns `{ draft, published, template, theme, fontPair, enabledSections }`.                                                                          |
| PATCH  | `/settings`              | `{ template?, theme?, fontPair?, enabledSections? }` | Partial update.                                                                                                                                      |
| PUT    | `/section/:kind`         | section body                                         | Validated against the matching zod schema. Upserts in `draft`.                                                                                       |
| DELETE | `/section/:kind`         | —                                                    | Clears the key from `draft`.                                                                                                                         |
| POST   | `/publish`               | —                                                    | Snapshots `draft` → `published`, sets `publishedAt`, writes `PortfolioRevision`, bumps tenant `status=PUBLISHED`, emits `portfolio.published` event. |
| POST   | `/unpublish`             | —                                                    | Clears `published`, sets `status=ARCHIVED`.                                                                                                          |
| GET    | `/revisions`             | —                                                    | Paginated (`?cursor=&limit=`).                                                                                                                       |
| POST   | `/revisions/:id/restore` | —                                                    | Restores a revision into `draft` (does not auto-publish).                                                                                            |

### 6.5 Assets — `/api/assets`

Direct-to-**R2** uploads via pre-signed PUT. Cloudflare R2 is S3-compatible, so we use `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` pointed at the R2 endpoint (`https://<account>.r2.cloudflarestorage.com`). Region must be `auto`. Public delivery goes through a Cloudflare custom domain bound to the bucket (e.g. `cdn.portfoli.app`) — do not expose the R2 endpoint directly.

| Method | Path       | Body                           | Notes                                                                                                                     |
| ------ | ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sign`    | `{ filename, mime, byteSize }` | Validates mime whitelist + size ≤ 8 MiB. Returns `{ uploadUrl, method: 'PUT', headers, key }`. Pre-signed URL TTL: 5 min. |
| POST   | `/confirm` | `{ key }`                      | HEADs the R2 object; verifies size/mime match the `/sign` intent; creates `Asset` row.                                    |
| GET    | `/`        | —                              | List assets for caller's portfolio.                                                                                       |
| DELETE | `/:id`     | —                              | Soft-delete (`deletedAt`) + enqueue R2 purge job.                                                                         |

**Mime whitelist:** `image/jpeg`, `image/png`, `image/webp`, `image/avif`. Reject SVG (XSS risk via inline scripts). Reject any mime not in the whitelist before signing.

**Post-upload pipeline** (BullMQ `assets-process` processor):

1. Download from R2 → sharp.
2. Strip EXIF (`sharp().rotate().withMetadata({ exif: {} })`).
3. Re-encode to `image/webp` at 2 widths: 1600px, 800px.
4. Upload both derivatives back to R2 under `<key>@1600.webp`, `<key>@800.webp`.
5. Update the `Asset` row with `width`, `height`, and derivative URLs in a `derivatives` JSONB column if present (extend entity if needed).

**Keying scheme:** `u/<userId>/p/<portfolioId>/<cuid>.<ext>` — stable, scoped, listable by prefix per user/portfolio.

**R2 quirks to respect:**

- No `ListBucket` in signed URLs — only `PutObject`/`GetObject`/`HeadObject`/`DeleteObject`.
- R2 ignores some S3 headers (e.g. `x-amz-server-side-encryption`) — do not send them; some SDK defaults must be disabled.
- CORS policy is configured on the bucket in the Cloudflare dashboard, not via the SDK. Document the exact config in `docs/r2-setup.md`: allow `PUT` + `HEAD` from the app origin; allow `GET` from `*`.
- Egress is free, but PUT requests cost per-million — batch-delete when purging a user.

### 6.6 Public (render layer) — `/api/public`

Served to the SSR render layer at `{subdomain}.portfoli.app`. Aggressively cached.

| Method | Path                      | Notes                                                                                                                                              |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/config?host=<hostname>` | Resolves subdomain or customDomain → returns published `PortfolioConfig`. Cached in Redis for 60s + CDN `s-maxage=60, stale-while-revalidate=300`. |
| POST   | `/inquiry`                | `{ tenantId, name, email, subject?, body }` — rate-limited per IP (5/hr) + per tenant (100/hr); hCaptcha token required.                           |
| POST   | `/pageview`               | `{ tenantId, path, referrer? }` — beacon endpoint; no auth; rate-limited.                                                                          |

Cache invalidation: `POST /portfolio/publish` fires a `portfolio.published` event; a listener deletes the Redis keys `public:config:sub:<subdomain>` and `public:config:dom:<customDomain>`.

### 6.7 Inquiries — `/api/inquiries`

| Method | Path        | Notes           |
| ------ | ----------- | --------------- |
| GET    | `/`         | Paginated list. |
| GET    | `/:id`      | Detail.         |
| POST   | `/:id/read` | Mark read.      |
| DELETE | `/:id`      | Delete.         |

Ingest flow: public submission → write row → enqueue mail job → send to owner's verified email via Resend with a templated MJML body + reply-to set to the submitter.

### 6.8 Analytics — `/api/analytics`

| Method | Path                          | Notes                               |
| ------ | ----------------------------- | ----------------------------------- | ---- | ---------------------- |
| GET    | `/overview?range=7d           | 30d                                 | 90d` | Totals + spark series. |
| GET    | `/top-pages?range=…&limit=10` | From `DailyStat.topPaths`.          |
| GET    | `/referrers?range=…&limit=10` | Grouped `referrer` from `PageView`. |
| GET    | `/countries?range=…`          | Grouped `country`.                  |

Ingest: `POST /api/public/pageview` writes a `PageView`. A nightly job aggregates to `DailyStat` and prunes raw rows older than 90 days. `sessionHash = sha256(tenantId + ip + ua + dailySalt)` — no raw IPs are stored.

### 6.9 Health — `/healthz`, `/readyz`

- `/healthz` → 200 always (process is up).
- `/readyz` → checks Postgres, Redis, S3 HEAD on a sentinel key; returns 503 on any failure.

---

## 7. Guards, pipes, interceptors

- `JwtAuthGuard` — decodes + verifies JWT, attaches `req.user`. Applied globally; endpoints opt out via `@Public()`.
- `TenantOwnerGuard` — resolves `tenantId` from path/body/`req.user` and enforces ownership. Required on every tenant-scoped endpoint.
- `ZodValidationPipe` — validates bodies/queries against zod schemas. Throws `UnprocessableEntityException` with flat path map.
- `RateLimitInterceptor` — token-bucket in Redis keyed by `(route, ip)` and, where relevant, `(route, userId)`.
- `LoggingInterceptor` — pino child logger with `reqId`, `userId`, `tenantId`, latency, status.
- `SerializationInterceptor` — wraps every response in `{ data: ... }` unless the controller already returned that shape.

---

## 8. Publishing pipeline

1. User clicks Publish in the editor.
2. `POST /api/portfolio/publish` validates that `draft` parses against the full section-wise zod schemas with `enabledSections` applied.
3. If valid, in a single transaction: copy `draft` → `published`, set `publishedAt = now()`, insert `PortfolioRevision`, set `Tenant.status = PUBLISHED`.
4. Emit event `portfolio.published { tenantId }`.
5. Listener: purge Redis cache, CDN purge by tag (`tenant:{id}`), warm the cache by fetching the config once.

Rollback: `POST /api/portfolio/revisions/:id/restore` copies a revision snapshot into `draft` (does not auto-publish — the user reviews then publishes).

---

## 9. Custom domains

Flow:

1. User submits `example.com`.
2. Backend creates `DomainVerification` with token `portfoli-verify=<32 hex chars>`.
3. UI shows the TXT record to add on `_portfoli.<domain>`.
4. User clicks Verify → enqueues `verify-domain` job.
5. Job resolves the TXT record (DoH via Cloudflare, 3-retry with backoff). On match, sets `verifiedAt`, moves domain onto `Tenant.customDomain`, and provisions a cert via the edge provider's ACME API.
6. On failure after 24h, mark `FAILED` and notify the user by email.

Resolution at the render layer: `/api/public/config?host=example.com` first checks `Tenant.customDomain` (unique index), then `subdomain`. Unknown host → 404.

---

## 10. Security

- **Helmet** with sane defaults + a strict CSP on the render layer (separate service — backend only sets CSP on its own responses).
- **CORS:** app origin (`https://app.portfoli.app`) + render origins (`*.portfoli.app` and verified custom domains — resolved at request time from DB, cached in Redis).
- **CSRF:** Not needed for JSON API with `Authorization` header and no cookies. Do not use cookies for auth.
- **Rate limits** (Redis token-bucket):
  - `POST /auth/login`: 10 / 15 min / IP, 5 / 15 min / email
  - `POST /auth/register`: 5 / hour / IP
  - `POST /auth/request-password-reset`: 3 / hour / email
  - `POST /public/inquiry`: 5 / hour / IP, 100 / hour / tenant
  - `POST /public/pageview`: 600 / minute / IP
  - Everything else: 300 / minute / user
- **Input sanitation:** all section bodies stripped of control chars; rendered as plain text (frontend escapes). No HTML input anywhere.
- **Asset uploads:** mime whitelist, size cap, re-encode through sharp (strips script content from malformed files).
- **SQL:** TypeORM repositories + `QueryBuilder` only. Raw SQL (`dataSource.query(...)` / `entityManager.query(...)`) requires a reviewed PR justification and must use parameter binding (`$1, $2, ...`). No string concatenation into queries — ever.
- **Dependencies:** `npm audit --omit=dev` must pass in CI. Renovate bot weekly.
- **Secrets:** env only. Prod secrets in the deploy platform's secret store. Rotate on personnel changes.
- **Account deletion:** GDPR-compliant — hard delete user + cascade + S3 purge within 30 days. Confirmation email sent.
- **PII in logs:** never log email, password, token, IP beyond the last octet. Pino redact paths enforced.

---

## 11. Performance budgets

- P95 API latency < 150 ms at 100 rps on a 1 vCPU / 1 GiB instance.
- `GET /api/public/config` < 30 ms cache hit, < 120 ms miss.
- DB connection pool: 10 connections per instance; set TypeORM `extra.max = 10` on the DataSource.
- N+1 guard: use `include`/`select` explicitly. Every endpoint that returns a list must be paginated.

---

## 12. Testing discipline

- **Unit tests** per service and pure-function module. Mock only what crosses a boundary (repositories via `jest.mocked<Repository<Entity>>()` — OK for pure unit tests only; prefer integration for anything that exercises real SQL).
- **Integration/e2e tests** with Testcontainers (real Postgres + Redis). R2 is not containerized — abstract the storage port behind an interface and wire a `LocalFsStorage` implementation in tests; production wires `R2Storage`. Each test runs in a TypeORM transaction that's rolled back via `QueryRunner.startTransaction()` in `beforeEach` and `rollbackTransaction()` in `afterEach`. This is the primary discipline — unit tests with mocked repositories do not count as coverage for data logic.
- **Contract tests:** one e2e per endpoint that asserts HTTP status, happy-path payload shape, and one failure mode.
- **Coverage target:** 85% lines, 80% branches on `src/modules/**`. Generated client, DTOs, config exempted.
- **CI gate:** lint + typecheck + unit + e2e must pass. PR blocks on failure.

---

## 13. Observability

- Every request gets a ULID `reqId`. Propagated in response header `x-request-id` and log context.
- Structured logs (`pino`), stdout only. Aggregator ingests.
- **Metrics** via Prometheus scrape endpoint `/metrics` (nest-prometheus): HTTP latency histogram, DB pool gauge, queue depth per queue, job durations, Redis ops/sec.
- **Tracing:** OpenTelemetry SDK, OTLP exporter → Tempo/Honeycomb.
- **Errors:** Sentry SDK in Nest module. Tag with `userId`, `tenantId`, `route`.
- **Uptime:** external probe on `/readyz` every 30s.

---

## 14. Environment variables

`.env.example`:

```env
NODE_ENV=development
PORT=4000
APP_ORIGIN=https://app.portfoli.app
RENDER_ORIGIN_SUFFIX=.portfoli.app

DATABASE_URL=postgresql://portfoli:portfoli@localhost:5432/portfoli
REDIS_URL=redis://localhost:6379

JWT_PRIVATE_KEY_PATH=./keys/jwt.ed25519        # actually RS256 for RS jwks; change to match
JWT_PUBLIC_KEY_PATH=./keys/jwt.pub
JWT_ACCESS_TTL_SEC=900
REFRESH_TTL_SEC=2592000

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=portfoli-assets
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
R2_REGION=auto
R2_PUBLIC_BASE_URL=https://cdn.portfoli.app          # custom domain bound to the bucket
R2_PRESIGN_TTL_SEC=300

RESEND_API_KEY=
MAIL_FROM="Portfoli <noreply@portfoli.app>"

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

HCAPTCHA_SECRET=
SENTRY_DSN=

SESSION_SALT=change-me-in-prod
ANALYTICS_SALT_ROTATION_CRON=0 0 * * *
```

Config module validates every value with zod at boot. Missing → fail fast with a clear error.

---

## 15. Queues (BullMQ)

| Queue                   | Producer                    | Consumer does                                                                                               |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `mail`                  | auth, inquiries             | Render MJML + send via Resend, retries 3× exp backoff.                                                      |
| `assets-process`        | assets.confirm              | Re-encode, strip EXIF, generate responsive sizes.                                                           |
| `domain-verify`         | domains.verify              | DNS lookup, cert provisioning.                                                                              |
| `analytics-rollup`      | cron daily 00:05 UTC        | Aggregate `PageView` → `DailyStat`, prune raw > 90d.                                                        |
| `analytics-salt-rotate` | cron daily 00:00 UTC        | Rotate `sessionHash` salt.                                                                                  |
| `r2-purge`              | users.delete, assets.delete | Batch-delete R2 object(s) (including `@1600`/`@800` derivatives), then hard-delete soft-deleted Asset rows. |

Each processor is its own file under `src/queue/processors/`, wired in `queue.module.ts`. Dead-letter: after max retries, move to `:failed`; a weekly cron emails a digest to ops.

---

## 16. Development workflow

1. `git clone` → `pnpm install` → `pnpm run infra:up` (docker-compose: postgres, redis, mailpit). R2 is remote — use a dev bucket (`portfoli-assets-dev`) with its own credentials in `.env.local`.
2. `pnpm run db:migrate` → `pnpm run db:seed`.
3. `pnpm run dev` (nest start --watch).
4. Before committing: `pnpm run lint && pnpm run typecheck && pnpm run test`.
5. PR template: summary + screenshots (if any) + test plan + migration notes (if any).
6. Branch naming: `feat/<area>-<verb>`, `fix/<area>-<verb>`, `chore/<…>`.
7. Commits: Conventional Commits. One logical change per commit. Do not commit broken tests.

---

## 17. Definition of done (per endpoint)

Before marking a ticket complete, all of the following are true:

- [ ] Controller, service, DTOs, zod schema written.
- [ ] Happy-path e2e test passes against real Postgres + Redis.
- [ ] At least one failure-mode e2e test (401, 403, 422, or 404).
- [ ] Rate limit (if applicable) applied and tested.
- [ ] Guard coverage (auth + tenant-owner where applicable).
- [ ] OpenAPI spec regenerated (`pnpm run openapi`).
- [ ] TypeORM migration generated, hand-reviewed (no noisy no-op diffs), and committed (if an entity changed).
- [ ] No `any`, no `@ts-ignore`, no `console.*`.
- [ ] Logs at `info` level carry `reqId`, `userId?`, `tenantId?`.
- [ ] If touching `/api/public/*`: cache key named, TTL justified, invalidation wired.
- [ ] PR description includes "Frontend impact: none / contract change: ..."

---

## 18. Style & conventions

- Services are pure-ish: TypeORM repository calls + pure logic. Side effects (email, queues, R2) go through injected ports (`MailPort`, `StoragePort`, `QueuePort`) so tests can swap them.
- Do not leak TypeORM entity instances past the service boundary. Controllers receive and return zod-inferred DTOs; map entity → DTO in the service.
- Use `Result<T, E>` only if the project already uses it — otherwise, throw typed Nest exceptions (`UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `UnprocessableEntityException`). Let the global filter format the response.
- No barrel files (`index.ts` re-exports) in module folders — they break tree-shaking and obscure imports. Barrel files are OK at the `common/` root.
- Name things for the concept, not the tech. `PortfolioService.publish()` not `PortfolioRepoWrapper`.
- Comments: only when the _why_ isn't obvious from the code. Never narrate the _what_.
- Tests are co-located: `portfolio.service.ts` next to `portfolio.service.spec.ts`. E2E tests live in `test/e2e/`.

---

## 19. What the frontend expects (quick reference)

| Screen         | Calls                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Auth           | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`                                       |
| Onboarding     | `POST /tenant/subdomain`, `PATCH /portfolio/settings`, `PUT /portfolio/section/:kind`                                      |
| Editor         | `GET /portfolio`, `PUT /portfolio/section/:kind`, `PATCH /portfolio/settings`, `POST /assets/sign`, `POST /assets/confirm` |
| Publish dialog | `POST /portfolio/publish`, `POST /portfolio/unpublish`, `POST /tenant/custom-domain`, `POST /tenant/custom-domain/verify`  |
| Dashboard      | `GET /portfolio`, `GET /analytics/overview`, `GET /inquiries?limit=5`                                                      |
| Analytics page | `GET /analytics/overview`, `GET /analytics/top-pages`, `GET /analytics/referrers`, `GET /analytics/countries`              |
| Settings       | `GET /users/me`, `PATCH /users/me`, `POST /users/me/password`, `POST /users/me/email-change`, `DELETE /users/me`           |
| Templates page | `PATCH /portfolio/settings`                                                                                                |
| Public render  | `GET /public/config?host=…`, `POST /public/inquiry`, `POST /public/pageview`                                               |

---

## 20. Things you must not do

- Do not add paid plans, usage limits, Stripe/webhooks for billing, feature gates, "upgrade" prompts.
- Do not store raw IP addresses beyond the current request context.
- Do not accept HTML or SVG input from users.
- Do not use cookies for authentication.
- Do not bypass the zod → DTO boundary. Controllers never receive unvalidated bodies.
- Do not write raw SQL unless justified in the PR description and reviewed.
- Do not cache per-user data in a shared namespace. Cache keys must include `userId` or `tenantId` wherever scoped.
- Do not emit breaking API changes without a version bump and a migration note.

---

## 21. First tickets (seed backlog)

If you're starting from zero, implement in this order. Each step leaves the system green.

1. Bootstrap: Nest app, zod-backed config module, pino, Sentry, `/healthz`, `/readyz`, Dockerfile, compose.
2. TypeORM DataSource + entities + initial migration + dev seed. Verify `synchronize: false` everywhere.
3. Auth module: register, login, refresh, logout, guard, argon2, sessions, rate limit.
4. Users module: `/me` GET + PATCH + password change + delete.
5. Tenants module: create-on-first-access, subdomain set, reserved list.
6. Portfolios module: GET, settings PATCH, section PUT/DELETE, publish/unpublish, revisions.
7. Assets module: sign, confirm, list, delete + processor.
8. Public module: config (cached), inquiry (captcha + rate limit), pageview (beacon).
9. Inquiries module: list, detail, read, delete + mail processor.
10. Domains module: request, verify, DNS worker, cert provisioning.
11. Analytics module: overview, top-pages, referrers, countries + nightly rollup.
12. OAuth: Google, GitHub.
13. Email verification + password reset flows.
14. Observability polish: metrics, tracing, dashboards.

Ship each behind its own PR. Each PR lands green (lint + types + tests) before the next starts.

---

End of brief. Build exactly what's here. When you finish a module, post a short note listing: what landed, the endpoints it exposes, and anything you had to deviate from in this doc (with the reason). Deviations are fine if justified — silent deviations are not.
