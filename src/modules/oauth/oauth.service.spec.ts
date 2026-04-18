import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Redis } from 'ioredis';
import { OAuthService } from './oauth.service';
import { OAuthStateCodec } from './oauth-state';
import { PROVIDERS } from './providers';
import type { User } from '../../database/entities/user.entity';
import type { OAuthAccount } from '../../database/entities/oauth-account.entity';
import type { AppConfigService } from '../../config/config.service';
import type { SessionService } from '../auth/session.service';
import type { AuthService } from '../auth/auth.service';

function makeRepo<T extends { id: string }>(seed: T[] = []) {
  const rows = new Map<string, T>(seed.map((r) => [r.id, r]));
  let counter = 0;
  return {
    rows,
    create(data: Partial<T>): T {
      counter += 1;
      return {
        id: `row_${counter}`,
        createdAt: new Date(),
        ...data,
      } as unknown as T;
    },
    async save(row: T): Promise<T> {
      rows.set(row.id, row);
      return row;
    },
    async findOne(opts: { where: Partial<T> }): Promise<T | null> {
      for (const r of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((r as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return r;
      }
      return null;
    },
  };
}

function makeRedis() {
  const store = new Map<string, string>();
  const get = jest.fn(async (key: string) => store.get(key) ?? null);
  const set = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  const del = jest.fn(async (key: string) => {
    store.delete(key);
    return 1;
  });
  return { get, set, del, store };
}

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): AppConfigService {
  return {
    apiOrigin: 'https://api.portfoli.app',
    appOrigin: 'https://app.portfoli.app',
    sessionSalt: 'test-session-salt-00000000',
    oauth: {
      google: { clientId: 'g-id', clientSecret: 'g-secret' },
      github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
    },
    ...overrides,
  } as unknown as AppConfigService;
}

function makeSessions(): SessionService {
  return {
    issue: jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date('2026-05-01T00:00:00Z'),
    }),
  } as unknown as SessionService;
}

function makeAuth(): AuthService {
  return {
    toPublic: jest.fn((u: User) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      emailVerified: false,
    })),
  } as unknown as AuthService;
}

function build(opts: { users?: User[]; links?: OAuthAccount[]; config?: AppConfigService } = {}) {
  const users = makeRepo<User>(opts.users ?? []);
  const links = makeRepo<OAuthAccount>(opts.links ?? []);
  const redis = makeRedis();
  const config = opts.config ?? makeConfig();
  const sessions = makeSessions();
  const auth = makeAuth();
  const svc = new OAuthService(
    users as unknown as Repository<User>,
    links as unknown as Repository<OAuthAccount>,
    redis as unknown as Redis,
    config,
    sessions,
    auth,
  );
  return { svc, users, links, redis, config, sessions, auth };
}

describe('OAuthService', () => {
  it('400s beginFlow when credentials are unset', async () => {
    const config = makeConfig({
      oauth: {
        google: { clientId: '', clientSecret: '' },
        github: { clientId: 'gh', clientSecret: 'gh' },
      },
    });
    const { svc } = build({ config });
    await expect(svc.beginFlow('google')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('beginFlow returns an authorization URL with a signed state', async () => {
    const { svc, config } = build();
    const out = await svc.beginFlow('github');
    expect(out.redirectUrl).toContain('github.com/login/oauth/authorize');
    const stateRaw = new URL(out.redirectUrl).searchParams.get('state');
    expect(stateRaw).toBeTruthy();
    const codec = new OAuthStateCodec(config.sessionSalt);
    const parsed = codec.verify(stateRaw!);
    expect(parsed.provider).toBe('github');
  });

  it('state codec rejects tampered payloads', () => {
    const codec = new OAuthStateCodec('secret');
    const token = codec.issue('google');
    const tampered = token.replace(/\.\w/, '.X');
    expect(() => codec.verify(tampered)).toThrow();
  });

  it('exchangeOtcForSession 401s on unknown code', async () => {
    const { svc } = build();
    await expect(svc.exchangeOtcForSession('bogus', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('handleCallback links the profile to an existing verified-email user', async () => {
    const existingUser = {
      id: 'u_existing',
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null,
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    } as unknown as User;
    const { svc, users, links, redis, config } = build({ users: [existingUser] });

    jest.spyOn(PROVIDERS.google, 'fetchProfile').mockResolvedValueOnce({
      providerUid: 'sub-1',
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null,
      emailVerified: true,
    });
    jest
      .spyOn(
        svc as unknown as { exchangeCodeForToken: (...args: unknown[]) => Promise<unknown> },
        'exchangeCodeForToken',
      )
      .mockResolvedValueOnce({ access_token: 'fake' });

    const codec = new OAuthStateCodec(config.sessionSalt);
    const state = codec.issue('google');
    const { redirectUrl } = await svc.handleCallback('google', 'code', state);

    expect(users.rows.size).toBe(1);
    expect(links.rows.size).toBe(1);
    const target = new URL(redirectUrl);
    expect(target.origin).toBe('https://app.portfoli.app');
    const otc = target.searchParams.get('code');
    expect(otc).toBeTruthy();
    expect(redis.set).toHaveBeenCalled();
  });

  it('handleCallback creates a new user when no match exists', async () => {
    const { svc, users, links, config } = build();
    jest.spyOn(PROVIDERS.github, 'fetchProfile').mockResolvedValueOnce({
      providerUid: '42',
      email: 'new@example.com',
      name: 'New User',
      avatarUrl: null,
      emailVerified: true,
    });
    jest
      .spyOn(
        svc as unknown as { exchangeCodeForToken: (...args: unknown[]) => Promise<unknown> },
        'exchangeCodeForToken',
      )
      .mockResolvedValueOnce({ access_token: 'fake' });
    const codec = new OAuthStateCodec(config.sessionSalt);
    const state = codec.issue('github');
    await svc.handleCallback('github', 'code', state);
    expect(users.rows.size).toBe(1);
    expect(links.rows.size).toBe(1);
    const user = Array.from(users.rows.values())[0]!;
    expect(user.passwordHash).toBeNull();
  });
});
