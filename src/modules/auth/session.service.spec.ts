import { UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Session } from '../../database/entities/session.entity';
import type { AppConfigService } from '../../config/config.service';
import { SessionService } from './session.service';
import type { TokenService } from './jwt.service';

/**
 * In-memory Session repository that behaves enough like TypeORM for the
 * rotate/reuse paths. We model the QueryBuilder used in revokeChain with a
 * minimal fluent chain.
 */
function makeRepo() {
  const rows = new Map<string, Session>();

  const qb = {
    _where: {} as Record<string, unknown>,
    _ids: [] as string[],
    update(): typeof qb {
      return qb;
    },
    set(): typeof qb {
      return qb;
    },
    where(clause: string, params: Record<string, unknown>): typeof qb {
      qb._where = { ...qb._where, ...params };
      return qb;
    },
    andWhere(clause: string, params?: Record<string, unknown>): typeof qb {
      if (params) qb._where = { ...qb._where, ...params };
      return qb;
    },
    whereInIds(ids: string[]): typeof qb {
      qb._ids = ids;
      return qb;
    },
    async execute(): Promise<{ affected: number }> {
      let affected = 0;
      for (const id of qb._ids.length > 0 ? qb._ids : Array.from(rows.keys())) {
        const row = rows.get(id);
        if (!row) continue;
        const uid = qb._where.userId;
        if (uid !== undefined && row.userId !== uid) continue;
        if (row.revokedAt) continue;
        row.revokedAt = new Date();
        affected += 1;
      }
      qb._where = {};
      qb._ids = [];
      return { affected };
    },
  };

  const repo = {
    create(data: Partial<Session>): Session {
      const row = { ...(data as Session) };
      row.id = row.id ?? Math.random().toString(36).slice(2, 14);
      return row as Session;
    },
    async save(row: Session): Promise<Session> {
      rows.set(row.id, row);
      return row;
    },
    async findOne(opts: { where: Partial<Session> }): Promise<Session | null> {
      for (const row of rows.values()) {
        let match = true;
        for (const [k, v] of Object.entries(opts.where)) {
          if ((row as unknown as Record<string, unknown>)[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) return row;
      }
      return null;
    },
    async delete(): Promise<{ affected: number }> {
      return { affected: 0 };
    },
    createQueryBuilder(): typeof qb {
      return qb;
    },
    _rows: rows,
  };
  return repo;
}

function makeConfig(): AppConfigService {
  return {
    jwt: { accessTtlSec: 900, refreshTtlSec: 60 * 60, privateKeyPath: '', publicKeyPath: '' },
  } as unknown as AppConfigService;
}

function makeTokens(): TokenService {
  let counter = 0;
  const tokens = {
    signAccess: (userId: string, sid: string) => `access.${userId}.${sid}`,
    generateRefreshToken: () => {
      counter += 1;
      const token = `refresh-${counter}`;
      return { token, hash: `h(${token})` };
    },
    hashRefreshToken: (t: string) => `h(${t})`,
  };
  return tokens as unknown as TokenService;
}

describe('SessionService', () => {
  it('issue persists a hashed refresh and returns access + refresh', async () => {
    const repo = makeRepo();
    const svc = new SessionService(
      repo as unknown as Repository<Session>,
      makeTokens(),
      makeConfig(),
    );
    const out = await svc.issue('u1', { userAgent: 'ua', ip: '1.2.3.4' });
    expect(out.accessToken).toMatch(/^access\.u1\./);
    expect(out.refreshToken).toBe('refresh-1');
    const [row] = Array.from(repo._rows.values());
    expect(row?.tokenHash).toBe('h(refresh-1)');
    expect(row?.revokedAt).toBeNull();
  });

  it('rotate issues a new pair and revokes the previous session', async () => {
    const repo = makeRepo();
    const svc = new SessionService(
      repo as unknown as Repository<Session>,
      makeTokens(),
      makeConfig(),
    );
    const first = await svc.issue('u1', {});
    const rotated = await svc.rotate(first.refreshToken, {});
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    const previous = await repo.findOne({ where: { tokenHash: 'h(refresh-1)' } });
    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.replacedById).toBeTruthy();
  });

  it('rotating an already-revoked refresh token raises and revokes the chain', async () => {
    const repo = makeRepo();
    const svc = new SessionService(
      repo as unknown as Repository<Session>,
      makeTokens(),
      makeConfig(),
    );
    const first = await svc.issue('u1', {});
    await svc.rotate(first.refreshToken, {}); // legit rotation
    await expect(svc.rotate(first.refreshToken, {})).rejects.toBeInstanceOf(UnauthorizedException);
    // Both the reused token AND its successor should now be revoked.
    const original = await repo.findOne({ where: { tokenHash: 'h(refresh-1)' } });
    const successor = await repo.findOne({ where: { tokenHash: 'h(refresh-2)' } });
    expect(original?.revokedAt).not.toBeNull();
    expect(successor?.revokedAt).not.toBeNull();
  });

  it('rotate rejects an unknown token', async () => {
    const repo = makeRepo();
    const svc = new SessionService(
      repo as unknown as Repository<Session>,
      makeTokens(),
      makeConfig(),
    );
    await expect(svc.rotate('never-issued', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotate rejects an expired token', async () => {
    const repo = makeRepo();
    const tokens = makeTokens();
    const svc = new SessionService(
      repo as unknown as Repository<Session>,
      tokens,
      makeConfig(),
    );
    const issued = await svc.issue('u1', {});
    const row = Array.from(repo._rows.values())[0]!;
    row.expiresAt = new Date(Date.now() - 60_000);
    await repo.save(row);
    await expect(svc.rotate(issued.refreshToken, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
