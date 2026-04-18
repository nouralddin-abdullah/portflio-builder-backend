import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Redis } from 'ioredis';
import { UsersService } from './users.service';
import type { User } from '../../database/entities/user.entity';
import type { VerificationToken } from '../../database/entities/verification-token.entity';
import type { PasswordService } from '../auth/password.service';
import type { SessionService } from '../auth/session.service';
import type { EventBus } from '../../common/events/event-bus.service';

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
      u.updatedAt = new Date();
      rows.set(u.id, u);
      return u;
    },
    async remove(u: User): Promise<User> {
      rows.delete(u.id);
      return u;
    },
  };
}

function makeVerificationRepo() {
  const rows: VerificationToken[] = [];
  return {
    rows,
    create(data: Partial<VerificationToken>): VerificationToken {
      return {
        id: `vt_${rows.length + 1}`,
        ...data,
      } as VerificationToken;
    },
    async save(row: VerificationToken): Promise<VerificationToken> {
      rows.push(row);
      return row;
    },
  };
}

function makeRedis(): { set: jest.Mock; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }) as unknown as jest.Mock,
  };
}

function makePasswordSvc(hashValue: string | null, verifyResult: boolean): PasswordService {
  return {
    hash: jest.fn().mockResolvedValue(hashValue ?? 'new-hash'),
    verify: jest.fn().mockResolvedValue(verifyResult),
    assertStrength: jest.fn(),
  } as unknown as PasswordService;
}

function makeSessionSvc() {
  return {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
}

function seedUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-04-10T00:00:00Z');
  return {
    id: 'u1',
    email: 'alice@example.com',
    emailVerifiedAt: null,
    passwordHash: 'h(current)',
    name: 'Alice',
    avatarUrl: null,
    headline: null,
    location: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as User;
}

function makeEventBus(): EventBus & { emit: jest.Mock } {
  return { emit: jest.fn(), on: jest.fn() } as unknown as EventBus & { emit: jest.Mock };
}

function build(userRepo: ReturnType<typeof makeUserRepo>, verifyRepo: ReturnType<typeof makeVerificationRepo>, passwords: PasswordService, sessions: ReturnType<typeof makeSessionSvc>, redis: ReturnType<typeof makeRedis>, events: EventBus = makeEventBus()) {
  return new UsersService(
    userRepo as unknown as Repository<User>,
    verifyRepo as unknown as Repository<VerificationToken>,
    passwords,
    sessions as unknown as SessionService,
    redis as unknown as Redis,
    events,
  );
}

describe('UsersService', () => {
  describe('getProfile', () => {
    it('returns a public profile shape', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const svc = build(userRepo, makeVerificationRepo(), makePasswordSvc(null, false), makeSessionSvc(), makeRedis());
      const profile = await svc.getProfile('u1');
      expect(profile.email).toBe('alice@example.com');
      expect(profile.emailVerified).toBe(false);
      expect(profile).not.toHaveProperty('passwordHash');
    });
  });

  describe('updateProfile', () => {
    it('patches provided fields only', async () => {
      const userRepo = makeUserRepo([seedUser({ name: 'Alice', headline: 'Hi' })]);
      const svc = build(userRepo, makeVerificationRepo(), makePasswordSvc(null, false), makeSessionSvc(), makeRedis());
      const out = await svc.updateProfile('u1', { name: 'Alicia' });
      expect(out.name).toBe('Alicia');
      expect(out.headline).toBe('Hi');
    });

    it('allows clearing nullable fields by passing null', async () => {
      const userRepo = makeUserRepo([seedUser({ headline: 'Hi' })]);
      const svc = build(userRepo, makeVerificationRepo(), makePasswordSvc(null, false), makeSessionSvc(), makeRedis());
      const out = await svc.updateProfile('u1', { headline: null });
      expect(out.headline).toBeNull();
    });
  });

  describe('requestEmailChange', () => {
    it('rejects when the new email matches the current one', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const svc = build(userRepo, makeVerificationRepo(), makePasswordSvc(null, false), makeSessionSvc(), makeRedis());
      await expect(
        svc.requestEmailChange('u1', { newEmail: 'ALICE@example.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the email is already taken', async () => {
      const userRepo = makeUserRepo([
        seedUser(),
        seedUser({ id: 'u2', email: 'bob@example.com' }),
      ]);
      const svc = build(userRepo, makeVerificationRepo(), makePasswordSvc(null, false), makeSessionSvc(), makeRedis());
      await expect(
        svc.requestEmailChange('u1', { newEmail: 'bob@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('persists a verification token and caches the pending email in redis', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const verifyRepo = makeVerificationRepo();
      const redis = makeRedis();
      const svc = build(userRepo, verifyRepo, makePasswordSvc(null, false), makeSessionSvc(), redis);
      await svc.requestEmailChange('u1', { newEmail: 'new@example.com' });
      expect(verifyRepo.rows).toHaveLength(1);
      expect(verifyRepo.rows[0]?.purpose).toBe('email_change');
      expect(verifyRepo.rows[0]?.userId).toBe('u1');
      const [cached] = Array.from(redis.store.values());
      expect(cached).toBe('new@example.com');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^email-change:/),
        'new@example.com',
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is wrong', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const passwords = makePasswordSvc('new-hash', false);
      const sessions = makeSessionSvc();
      const svc = build(userRepo, makeVerificationRepo(), passwords, sessions, makeRedis());
      await expect(
        svc.changePassword('u1', 'sess-1', { current: 'wrong', next: 'brand-new-pass-9' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('hashes the new password and revokes other sessions', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const passwords = makePasswordSvc('$argon2id$new', true);
      const sessions = makeSessionSvc();
      const svc = build(userRepo, makeVerificationRepo(), passwords, sessions, makeRedis());
      await svc.changePassword('u1', 'sess-1', {
        current: 'correct',
        next: 'brand-new-pass-9',
      });
      expect(userRepo.rows.get('u1')?.passwordHash).toBe('$argon2id$new');
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1', 'sess-1');
    });
  });

  describe('deleteAccount', () => {
    it('rejects a wrong password without removing the user', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const passwords = makePasswordSvc(null, false);
      const svc = build(userRepo, makeVerificationRepo(), passwords, makeSessionSvc(), makeRedis());
      await expect(svc.deleteAccount('u1', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userRepo.rows.has('u1')).toBe(true);
    });

    it('removes the user when the password matches', async () => {
      const userRepo = makeUserRepo([seedUser()]);
      const passwords = makePasswordSvc(null, true);
      const svc = build(userRepo, makeVerificationRepo(), passwords, makeSessionSvc(), makeRedis());
      await svc.deleteAccount('u1', 'correct');
      expect(userRepo.rows.has('u1')).toBe(false);
    });
  });
});
