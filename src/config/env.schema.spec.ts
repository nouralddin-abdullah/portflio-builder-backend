import { envSchema } from './env.schema';

const VALID: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  APP_ORIGIN: 'https://app.portfoli.app',
  RENDER_ORIGIN_SUFFIX: '.portfoli.app',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY_PATH: './keys/jwt.key',
  JWT_PUBLIC_KEY_PATH: './keys/jwt.pub',
  SESSION_SALT: 'super-secret-session-salt',
};

describe('envSchema', () => {
  it('parses a valid env', () => {
    const parsed = envSchema.parse(VALID);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.R2_REGION).toBe('auto');
    expect(parsed.JWT_ACCESS_TTL_SEC).toBe(900);
  });

  it('rejects missing required vars', () => {
    const partial: NodeJS.ProcessEnv = { ...VALID };
    delete partial.DATABASE_URL;
    const res = envSchema.safeParse(partial);
    expect(res.success).toBe(false);
  });

  it('rejects bad port numbers', () => {
    const res = envSchema.safeParse({ ...VALID, PORT: 'abc' });
    expect(res.success).toBe(false);
  });

  it('rejects a render suffix missing a leading dot', () => {
    const res = envSchema.safeParse({ ...VALID, RENDER_ORIGIN_SUFFIX: 'portfoli.app' });
    expect(res.success).toBe(false);
  });

  it('rejects a short session salt', () => {
    const res = envSchema.safeParse({ ...VALID, SESSION_SALT: 'short' });
    expect(res.success).toBe(false);
  });
});
