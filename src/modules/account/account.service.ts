import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { User } from '../../database/entities/user.entity';
import {
  VerificationToken,
  type VerificationPurpose,
} from '../../database/entities/verification-token.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { AccountQueue } from './account.queue';

const EMAIL_VERIFY_TTL_SEC = 60 * 60 * 24;
const EMAIL_CHANGE_TTL_SEC = 60 * 60 * 24;
const PASSWORD_RESET_TTL_SEC = 60 * 60;
const EMAIL_CHANGE_REDIS_PREFIX = 'email-change:';

export interface EmailVerifyEnqueueResult {
  tokenId: string;
  alreadyVerified: boolean;
}

/**
 * Account lifecycle flows: email verification, email-change confirm, and
 * password reset (forgot + redeem). Kept out of `auth` so AuthModule can
 * stay focused on register/login/refresh — this module owns anything that
 * touches tokens-in-email.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(VerificationToken)
    private readonly verifications: Repository<VerificationToken>,
    @InjectRepository(PasswordResetToken)
    private readonly resets: Repository<PasswordResetToken>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
    private readonly queue: AccountQueue,
  ) {}

  /**
   * Idempotent request: always succeeds, even if the address is already
   * verified (in which case we skip the mail to avoid confusing the user).
   */
  async requestEmailVerification(userId: string): Promise<EmailVerifyEnqueueResult> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      // Shouldn't happen under an authenticated request, but be defensive.
      throw new UnauthorizedException({ code: 'unauthorized', message: 'Session is invalid.' });
    }
    if (user.emailVerifiedAt) {
      return { tokenId: '', alreadyVerified: true };
    }
    const { rawToken, row } = await this.issueVerification(userId, 'email_verify');
    await this.queue.enqueueMail({
      kind: 'email_verify',
      userId,
      tokenId: row.id,
      to: user.email,
      link: this.buildLink('verify-email', rawToken),
    });
    return { tokenId: row.id, alreadyVerified: false };
  }

  async confirmEmailVerification(rawToken: string): Promise<void> {
    const row = await this.redeemVerification(rawToken, 'email_verify');
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The verification link is invalid.',
      });
    }
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await this.users.save(user);
    }
  }

  /**
   * Sends the email-change confirmation link. Called from UsersService via
   * the `user.email_change_requested` event — the row has already been
   * written, we only own the mail dispatch here.
   */
  async dispatchEmailChangeMail(params: {
    userId: string;
    tokenId: string;
    newEmail: string;
    rawToken: string;
  }): Promise<void> {
    await this.queue.enqueueMail({
      kind: 'email_change',
      userId: params.userId,
      tokenId: params.tokenId,
      to: params.newEmail,
      link: this.buildLink('confirm-email-change', params.rawToken),
    });
  }

  async confirmEmailChange(rawToken: string): Promise<void> {
    const row = await this.redeemVerification(rawToken, 'email_change');
    const redisKey = `${EMAIL_CHANGE_REDIS_PREFIX}${row.tokenHash}`;
    const newEmail = await this.redis.get(redisKey);
    if (!newEmail) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The email-change link is no longer valid.',
      });
    }
    await this.redis.del(redisKey);

    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The email-change link is invalid.',
      });
    }
    const taken = await this.users.exist({ where: { email: newEmail } });
    if (taken && user.email !== newEmail) {
      throw new ConflictException({
        code: 'email_taken',
        message: 'An account with this email already exists.',
      });
    }
    user.email = newEmail;
    user.emailVerifiedAt = new Date();
    await this.users.save(user);
    // All sessions stay alive — the account didn't change hands.
  }

  /**
   * Intentionally silent on unknown emails: always returns without signal
   * to prevent address enumeration. The *rate limiter* protects this
   * endpoint (PASSWORD_RESET_EMAIL_RULE) from being used as an oracle.
   */
  async requestPasswordReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      this.logger.log({ msg: 'password_reset_unknown_email' });
      return;
    }
    if (!user.passwordHash) {
      // OAuth-only accounts have no password to reset. Still silent to
      // avoid leaking that the address is OAuth-bound.
      this.logger.log({ msg: 'password_reset_oauth_only', userId: user.id });
      return;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SEC * 1000);

    const row = this.resets.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      usedAt: null,
    });
    await this.resets.save(row);

    await this.queue.enqueueMail({
      kind: 'password_reset',
      userId: user.id,
      tokenId: row.id,
      to: user.email,
      link: this.buildLink('reset-password', rawToken),
    });
  }

  /**
   * Redeems a password-reset token. On success: swaps the hash, marks the
   * token used, revokes every session (the requester has to log in again
   * — required because they may or may not be the original device).
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.resets.findOne({ where: { tokenHash } });
    if (!row) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The reset link is invalid.',
      });
    }
    if (row.usedAt) {
      throw new UnauthorizedException({
        code: 'token_used',
        message: 'The reset link has already been used.',
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'token_expired',
        message: 'The reset link has expired.',
      });
    }
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The reset link is invalid.',
      });
    }

    user.passwordHash = await this.passwords.hash(newPassword);
    await this.users.save(user);

    row.usedAt = new Date();
    await this.resets.save(row);

    // Revoke all other sessions defensively.
    await this.sessions.revokeAllForUser(user.id);
  }

  /** Sweeps expired/used token rows. Wired to a BullMQ repeatable in the processor. */
  async pruneExpired(): Promise<number> {
    const now = new Date();
    const v = await this.verifications.delete({ expiresAt: LessThan(now) });
    const p = await this.resets.delete({ expiresAt: LessThan(now) });
    return (v.affected ?? 0) + (p.affected ?? 0);
  }

  private async issueVerification(
    userId: string,
    purpose: VerificationPurpose,
  ): Promise<{ rawToken: string; row: VerificationToken }> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const ttl = purpose === 'email_change' ? EMAIL_CHANGE_TTL_SEC : EMAIL_VERIFY_TTL_SEC;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const row = this.verifications.create({
      userId,
      tokenHash,
      purpose,
      expiresAt,
      usedAt: null,
    });
    await this.verifications.save(row);
    return { rawToken, row };
  }

  private async redeemVerification(
    rawToken: string,
    expected: VerificationPurpose,
  ): Promise<VerificationToken> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.verifications.findOne({ where: { tokenHash } });
    if (!row || row.purpose !== expected) {
      throw new UnauthorizedException({
        code: 'token_invalid',
        message: 'The link is invalid.',
      });
    }
    if (row.usedAt) {
      throw new UnauthorizedException({
        code: 'token_used',
        message: 'The link has already been used.',
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'token_expired',
        message: 'The link has expired.',
      });
    }
    row.usedAt = new Date();
    await this.verifications.save(row);
    return row;
  }

  private buildLink(path: string, rawToken: string): string {
    const url = new URL(`/auth/${path}`, this.config.appOrigin);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }
}
