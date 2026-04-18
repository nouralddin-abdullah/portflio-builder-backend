import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Session } from '../../database/entities/session.entity';
import { AppConfigService } from '../../config/config.service';
import { TokenService } from './jwt.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
  ) {}

  /** Issues a new access + refresh pair and persists the hashed refresh as a Session row. */
  async issue(
    userId: string,
    context: { userAgent?: string | null; ip?: string | null },
  ): Promise<IssuedTokens> {
    const { token: refreshToken, hash: tokenHash } = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlSec * 1000);

    const session = this.sessions.create({
      userId,
      tokenHash,
      userAgent: context.userAgent ?? null,
      ip: context.ip ?? null,
      expiresAt,
      revokedAt: null,
      replacedById: null,
    });
    await this.sessions.save(session);

    return {
      accessToken: this.tokens.signAccess(userId, session.id),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates a refresh token. On reuse of a revoked token, revokes the whole chain
   * (the original session and everything it spawned) and raises — this is the
   * security alert hook (the mailer subscribes in T13).
   */
  async rotate(
    presentedToken: string,
    context: { userAgent?: string | null; ip?: string | null },
  ): Promise<IssuedTokens & { userId: string }> {
    const presentedHash = this.tokens.hashRefreshToken(presentedToken);
    const current = await this.sessions.findOne({ where: { tokenHash: presentedHash } });
    if (!current) {
      throw new UnauthorizedException({
        code: 'invalid_refresh',
        message: 'Refresh token is invalid.',
      });
    }
    if (current.revokedAt) {
      await this.revokeChain(current);
      throw new UnauthorizedException({
        code: 'refresh_reuse_detected',
        message: 'Session compromised. All sessions have been revoked.',
      });
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'expired_refresh',
        message: 'Refresh token has expired.',
      });
    }

    const { token: newRefresh, hash: newHash } = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.jwt.refreshTtlSec * 1000);

    const next = this.sessions.create({
      userId: current.userId,
      tokenHash: newHash,
      userAgent: context.userAgent ?? current.userAgent,
      ip: context.ip ?? current.ip,
      expiresAt,
    });
    await this.sessions.save(next);

    current.revokedAt = new Date();
    current.replacedById = next.id;
    await this.sessions.save(current);

    return {
      userId: current.userId,
      accessToken: this.tokens.signAccess(current.userId, next.id),
      refreshToken: newRefresh,
      expiresAt,
    };
  }

  async revokeByToken(presentedToken: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(presentedToken);
    const session = await this.sessions.findOne({ where: { tokenHash: hash } });
    if (!session || session.revokedAt) return;
    session.revokedAt = new Date();
    await this.sessions.save(session);
  }

  async revokeAllForUser(userId: string, except?: string): Promise<void> {
    const qb = this.sessions
      .createQueryBuilder()
      .update(Session)
      .set({ revokedAt: () => 'now()' })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL');
    if (except) qb.andWhere('id <> :except', { except });
    await qb.execute();
  }

  async findById(id: string): Promise<Session | null> {
    return this.sessions.findOne({ where: { id } });
  }

  async pruneExpired(): Promise<void> {
    await this.sessions.delete({ expiresAt: LessThan(new Date()) });
  }

  /**
   * Walks the forward chain (`replaced_by_id`) from a detected-reuse node and
   * revokes every descendant plus the originating session.
   */
  private async revokeChain(start: Session): Promise<void> {
    const ids: string[] = [start.id];
    let cursor: Session | null = start;
    while (cursor?.replacedById) {
      const next: Session | null = await this.sessions.findOne({
        where: { id: cursor.replacedById },
      });
      if (!next) break;
      ids.push(next.id);
      cursor = next;
    }
    await this.sessions
      .createQueryBuilder()
      .update(Session)
      .set({ revokedAt: () => 'now()' })
      .whereInIds(ids)
      .andWhere('revoked_at IS NULL')
      .execute();
  }
}
