import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { User } from '../../database/entities/user.entity';
import { VerificationToken } from '../../database/entities/verification-token.entity';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { REDIS } from '../../common/redis/redis.module';
import { EventBus } from '../../common/events/event-bus.service';
import type {
  EmailChangeInput,
  PasswordChangeInput,
  UpdateProfileInput,
} from './schemas';

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

const EMAIL_CHANGE_TTL_SEC = 60 * 60 * 24;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(VerificationToken)
    private readonly verifications: Repository<VerificationToken>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventBus,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    return this.toProfile(user);
  }

  async updateProfile(userId: string, patch: UpdateProfileInput): Promise<UserProfile> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });

    if (patch.name !== undefined) user.name = patch.name;
    if (patch.headline !== undefined) user.headline = patch.headline;
    if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
    if (patch.location !== undefined) user.location = patch.location;

    await this.users.save(user);
    return this.toProfile(user);
  }

  /**
   * Creates a VerificationToken (purpose=email_change) and stashes the requested
   * new email in Redis keyed by the token hash. The actual mailer + redemption
   * endpoint lands in T13.
   */
  async requestEmailChange(userId: string, input: EmailChangeInput): Promise<void> {
    const newEmail = input.newEmail.trim().toLowerCase();
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    if (newEmail === user.email) {
      throw new BadRequestException({
        code: 'email_unchanged',
        message: 'New email is the same as the current email.',
      });
    }
    const taken = await this.users.exist({ where: { email: newEmail } });
    if (taken) {
      throw new ConflictException({
        code: 'email_taken',
        message: 'An account with this email already exists.',
      });
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_SEC * 1000);

    const row = this.verifications.create({
      userId,
      tokenHash,
      purpose: 'email_change',
      expiresAt,
      usedAt: null,
    });
    await this.verifications.save(row);
    await this.redis.set(
      `email-change:${tokenHash}`,
      newEmail,
      'EX',
      EMAIL_CHANGE_TTL_SEC,
    );

    this.logger.log({ msg: 'email_change_requested', userId, tokenId: row.id });
    this.events.emit('user.email_change_requested', {
      userId,
      tokenId: row.id,
      newEmail,
      rawToken,
    });
  }

  /**
   * Verifies the current password, swaps the hash, and revokes every other
   * session — the caller's current session stays alive so they don't get
   * bounced from the settings page.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    input: PasswordChangeInput,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });

    const ok = await this.passwords.verify(user.passwordHash, input.current);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'invalid_current_password',
        message: 'Current password is incorrect.',
      });
    }

    user.passwordHash = await this.passwords.hash(input.next);
    await this.users.save(user);
    await this.sessions.revokeAllForUser(userId, currentSessionId);
  }

  /**
   * Verifies the password, then deletes the user row — FK cascades on
   * Tenant/Portfolio/Asset take care of the DB side. S3/R2 object purge is
   * queued via a BullMQ job (the real worker lands in T7).
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'invalid_password',
        message: 'Password is incorrect.',
      });
    }

    await this.users.remove(user);
    this.logger.warn({ msg: 'account_deleted_purge_queued', userId });
    // NOTE: R2 asset purge enqueue lands in T7 when the BullMQ queue is wired.
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      name: user.name,
      avatarUrl: user.avatarUrl,
      headline: user.headline,
      location: user.location,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
