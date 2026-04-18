# Portfoli Backend

NestJS 10 backend for **Portfoli**, a free, multi-tenant portfolio builder. Full spec in [`BACKEND-TASK.md`](./BACKEND-TASK.md).

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm infra:up           # postgres, redis, mailpit
pnpm db:migrate         # runs once schema lands (T2)
pnpm dev                # http://localhost:4000
```

### Generate JWT keys (dev)

```bash
mkdir -p keys
openssl genpkey -algorithm RSA -out keys/jwt.key -pkeyopt rsa_keygen_bits:2048
openssl rsa -in keys/jwt.key -pubout -out keys/jwt.pub
```

## Scripts

| Command                | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `pnpm dev`             | Nest watch mode                                    |
| `pnpm build`           | Compile to `dist/`                                 |
| `pnpm lint`            | ESLint (flat config)                               |
| `pnpm typecheck`       | `tsc --noEmit`                                     |
| `pnpm test`            | Jest unit tests                                    |
| `pnpm test:e2e`        | Supertest + Testcontainers e2e suite               |
| `pnpm db:migrate`      | Apply TypeORM migrations                           |
| `pnpm db:migrate:gen`  | Generate a migration from entity diff              |
| `pnpm infra:up`        | docker compose: postgres, redis, mailpit           |

## Ticket map

Implementation follows section 21 of the spec. Current progress lives in the session task list. Endpoint-level acceptance criteria are in section 17 ("Definition of done").
