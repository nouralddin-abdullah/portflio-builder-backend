import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { AccountService } from './account.service';
import type { User } from '../../database/entities/user.entity';
import type { VerificationToken } from '../../database/entities/verification-token.entity';
import type { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import type { PasswordService } from '../auth/password.service';
import type { SessionService } from '../auth/session.service';
import type { AppConfigService } from '../../config/config.service';
import type { AccountQueue } from './account.queue';

function makeUserRepo(seed: User[] = []) {
  const rows = new Map<string, User>(seed.map((u) => [u.id, u]));
  return {
    rows,
    async findOne(opts: { where: Partial<User> }): Promise<User | null> {
      for (const u of rows.values()) {
        let ok = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((u as unknown as Record<string, unknown>)[k] !== v) {
            ok = false;
            break;
          }
        }
        if (ok) return u;
      }
      return null;
    },
    async exist(opts: { where: Partial<User> }): Promise<boolean> {
      return (await this.findOne(opts)) !== null;
    },
    async save(u: User): Promise<User> {
      rows.set(u.id, u);
      return u;
    },
  };
}

function makeTokenRepo<T extends { id: string; tokenHash: string }>() {
  const rows: T[] = [];
  let counter = 0;
  return {
    rows,
    create(data: Partial<T>): T {
      counter += 1;
      return { id: `tk_${counter}`, ...data } as T;
    },
    async save(row: T): Promise<T> {
      const existing = rows.findIndex((r) => r.id === row.id);
      if (existing >= 0) rows[existing] = row;
      else rows.push(row);
      return row;
    },
    async findOne(opts: { where: Partial<T> }): Promise<T | null> {
      for (const r of rows) {
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
    async delete(_opts: unknown): Promise<{ affected: number }> {
      return { affected: 0 };
    },
  };
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

function makePasswords(): PasswordService {
  return {
    hash: jest.fn(async (p: string) => `h(${p})`),
    verify: jest.fn().mockResolvedValue(true),
    assertStrength: jest.fn(),
  } as unknown as PasswordService;
}

function makeSessions() {
  return {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
}

function makeConfig(): AppConfigService {
  return { appOrigin: 'https://app.portfoli.app' } as unknown as AppConfigService;
}

function makeQueue(): AccountQueue & { enqueueMail: jest.Mock } {
  return { enqueueMail: jest.fn().mockResolvedValue(undefined) } as unknown as AccountQueue & {
    enqueueMail: jest.Mock;
  };
}

function seedUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-04-18T00:00:00Z');
  return {
    id: 'u1',
    email: 'alice@example.com',
    emailVerifiedAt: null,
    passwordHash: 'h(old)',
    name: 'Alice',
    avatarUrl: null,
    headline: null,
    location: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as User;
}

function build(opts: { users?: User[] } = {}) {
  const users = makeUserRepo(opts.users ?? []);
  const verifications = makeTokenRepo<VerificationToken>();
  const resets = makeTokenRepo<PasswordResetToken>();
  const redis = makeRedis();
  const passwords = makePasswords();
  const sessions = makeSessions();
  const config = makeConfig();
  const queue = makeQueue();
  const svc = new AccountService(
    users as unknown as Repository<User>,
    verifications as unknown as Repository<VerificationToken>,
    resets as unknown as Repository<PasswordResetToken>,
    redis as unknown as Redis,
    passwords,
    sessions as unknown as SessionService,
    config,
    queue,
  );
  return { svc, users, verifications, resets, redis, passwords, sessions, queue };
}

describe('AccountService', () => {
  describe('requestEmailVerification', () => {
    it('skips enqueue when the account is already verified', async () => {
      const { svc, queue } = build({
        users: [seedUser({ emailVerifiedAt: new Date() })],
      });
      const res = await svc.requestEmailVerification('u1');
      expect(res.alreadyVerified).toBe(true);
      expect(queue.enqueueMail).not.toHaveBeenCalled();
    });

    it('creates a verification token and enqueues a verify mail', async () => {
      const { svc, verifications, queue } = build({ users: [seedUser()] });
      const res = await svc.requestEmailVerification('u1');
      expect(res.alreadyVerified).toBe(false);
      expect(verifications.rows).toHaveLength(1);
      expect(verifications.rows[0]?.purpose).toBe('email_verify');
      expect(queue.enqueueMail).toHaveBeenCalledTimes(1);
      const job = queue.enqueueMail.mock.calls[0]?.[0] as { kind: string; link: string; to: string };
      expect(job.kind).toBe('email_verify');
      expect(job.to).toBe('alice@example.com');
      expect(job.link).toMatch(/^https:\/\/app\.portfoli\.app\/auth\/verify-email\?token=/);
    });
  });

  describe('confirmEmailVerification', () => {
    it('401s on an unknown token', async () => {
      const { svc } = build({ users: [seedUser()] });
      await expect(svc.confirmEmailVerification('bogus')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('marks the user verified and idempotently succeeds', async () => {
      const { svc, users, verifications } = build({ users: [seedUser()] });
      await svc.requestEmailVerification('u1');
      // Steal the raw token via the stored hash: we need a round-trip fixture.
      // Instead, reissue directly so we know the raw value:
      const raw = 'raw_email_verify_token_00000000000';
      const hash = createHash('sha256').update(raw).digest('hex');
      verifications.rows.push({
        id: 'vt_custom',
        userId: 'u1',
        tokenHash: hash,
        purpose: 'email_verify',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      } as VerificationToken);

      await svc.confirmEmailVerification(raw);
      expect(users.rows.get('u1')?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('rejects expired tokens', async () => {
      const { svc, verifications } = build({ users: [seedUser()] });
      const raw = 'expired_token_xxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      verifications.rows.push({
        id: 'vt_exp',
        userId: 'u1',
        tokenHash: hash,
        purpose: 'email_verify',
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: null,
        createdAt: new Date(),
      } as VerificationToken);
      await expect(svc.confirmEmailVerification(raw)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a used token', async () => {
      const { svc, verifications } = build({ users: [seedUser()] });
      const raw = 'used_token_xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      verifications.rows.push({
        id: 'vt_used',
        userId: 'u1',
        tokenHash: hash,
        purpose: 'email_verify',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        createdAt: new Date(),
      } as VerificationToken);
      await expect(svc.confirmEmailVerification(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('confirmEmailChange', () => {
    it('swaps the email when the Redis pending-email is present', async () => {
      const { svc, users, verifications, redis } = build({ users: [seedUser()] });
      const raw = 'changetok_xxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      verifications.rows.push({
        id: 'vt_ch',
        userId: 'u1',
        tokenHash: hash,
        purpose: 'email_change',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      } as VerificationToken);
      redis.store.set(`email-change:${hash}`, 'new@example.com');

      await svc.confirmEmailChange(raw);
      expect(users.rows.get('u1')?.email).toBe('new@example.com');
      expect(users.rows.get('u1')?.emailVerifiedAt).toBeInstanceOf(Date);
      expect(redis.del).toHaveBeenCalledWith(`email-change:${hash}`);
    });

    it('rejects when the Redis pending-email is missing', async () => {
      const { svc, verifications } = build({ users: [seedUser()] });
      const raw = 'orphan_token_xxxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      verifications.rows.push({
        id: 'vt_orphan',
        userId: 'u1',
        tokenHash: hash,
        purpose: 'email_change',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      } as VerificationToken);
      await expect(svc.confirmEmailChange(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('requestPasswordReset', () => {
    it('is silent and does not enqueue when the email is unknown', async () => {
      const { svc, queue, resets } = build();
      await svc.requestPasswordReset('ghost@example.com');
      expect(queue.enqueueMail).not.toHaveBeenCalled();
      expect(resets.rows).toHaveLength(0);
    });

    it('skips OAuth-only accounts silently', async () => {
      const { svc, queue } = build({
        users: [seedUser({ passwordHash: null as unknown as string })],
      });
      await svc.requestPasswordReset('alice@example.com');
      expect(queue.enqueueMail).not.toHaveBeenCalled();
    });

    it('enqueues a reset mail for a known password user', async () => {
      const { svc, queue, resets } = build({ users: [seedUser()] });
      await svc.requestPasswordReset('ALICE@example.com');
      expect(resets.rows).toHaveLength(1);
      expect(queue.enqueueMail).toHaveBeenCalledTimes(1);
      const job = queue.enqueueMail.mock.calls[0]?.[0] as { kind: string };
      expect(job.kind).toBe('password_reset');
    });
  });

  describe('resetPassword', () => {
    it('updates the hash and revokes sessions', async () => {
      const { svc, users, resets, sessions } = build({ users: [seedUser()] });
      const raw = 'resetme_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      resets.rows.push({
        id: 'pr_1',
        userId: 'u1',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      } as PasswordResetToken);

      await svc.resetPassword(raw, 'MyNewStrongPw1!');
      expect(users.rows.get('u1')?.passwordHash).toBe('h(MyNewStrongPw1!)');
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(resets.rows[0]?.usedAt).toBeInstanceOf(Date);
    });

    it('rejects an already-used token', async () => {
      const { svc, resets } = build({ users: [seedUser()] });
      const raw = 'usedreset_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const hash = createHash('sha256').update(raw).digest('hex');
      resets.rows.push({
        id: 'pr_used',
        userId: 'u1',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        createdAt: new Date(),
      } as PasswordResetToken);
      await expect(svc.resetPassword(raw, 'AnotherStrongPw9!')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown token', async () => {
      const { svc } = build({ users: [seedUser()] });
      await expect(svc.resetPassword('nope', 'AnotherStrongPw9!')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
