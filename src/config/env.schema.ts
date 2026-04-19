import { z } from 'zod';

const boolLike = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const intLike = (min?: number, max?: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v, ctx) => {
      const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be an integer' });
        return z.NEVER;
      }
      if (min !== undefined && n < min) {
        ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, inclusive: true, type: 'number' });
        return z.NEVER;
      }
      if (max !== undefined && n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: 'number' });
        return z.NEVER;
      }
      return n;
    });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intLike(1, 65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_ORIGIN: z.string().url(),
  API_ORIGIN: z.string().url().default('http://localhost:4000'),
  RENDER_ORIGIN_SUFFIX: z.string().regex(/^\.[a-z0-9.-]+$/i, 'must start with a dot'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /**
   * Namespace for every Redis key this service reads/writes. Set this when sharing
   * a Redis instance with other projects so keys don't collide.
   */
  REDIS_KEY_PREFIX: z.string().default('portfilo:'),

  JWT_PRIVATE_KEY_PATH: z.string().min(1),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
  JWT_ACCESS_TTL_SEC: intLike(60).default(900),
  REFRESH_TTL_SEC: intLike(3600).default(2_592_000),

  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default('portfoli-assets'),
  R2_ENDPOINT: z.string().url().optional().or(z.literal('')),
  R2_REGION: z.string().default('auto'),
  R2_PUBLIC_BASE_URL: z.string().url().optional().or(z.literal('')),
  R2_PRESIGN_TTL_SEC: intLike(30, 3600).default(300),

  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('Portfoli <noreply@portfoli.app>'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),

  HCAPTCHA_SECRET: z.string().default(''),
  SENTRY_DSN: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : Number.parseFloat(v)))
    .pipe(z.number().min(0).max(1))
    .default(0.1),

  SESSION_SALT: z.string().min(8, 'SESSION_SALT must be at least 8 chars'),
  ANALYTICS_SALT_ROTATION_CRON: z.string().default('0 0 * * *'),

  OPENAPI_ENABLED: boolLike.default(true),
});

export type Env = z.infer<typeof envSchema>;
