import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { PasswordService } from './password.service';
import { SessionService, type IssuedTokens } from './session.service';
import type { LoginInput, RegisterInput } from './schemas';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface AuthResponse extends IssuedTokens {
  user: AuthedUser;
}

export interface RequestContext {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async register(input: RegisterInput, ctx: RequestContext): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();
    const exists = await this.users.exist({ where: { email } });
    if (exists) {
      throw new ConflictException({
        code: 'email_taken',
        message: 'An account with this email already exists.',
      });
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = this.users.create({
      email,
      passwordHash,
      name: input.name.trim(),
      avatarUrl: null,
      headline: null,
      location: null,
      emailVerifiedAt: null,
    });
    await this.users.save(user);

    const tokens = await this.sessions.issue(user.id, ctx);
    return { ...tokens, user: this.toPublic(user) };
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });
    const ok = user ? await this.passwords.verify(user.passwordHash, input.password) : false;
    if (!user || !ok) {
      // Identical error for missing email + wrong password to deny enumeration.
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }
    const tokens = await this.sessions.issue(user.id, ctx);
    return { ...tokens, user: this.toPublic(user) };
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<AuthResponse> {
    const rotated = await this.sessions.rotate(refreshToken, ctx);
    const user = await this.users.findOne({ where: { id: rotated.userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'invalid_refresh',
        message: 'Refresh token is invalid.',
      });
    }
    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresAt: rotated.expiresAt,
      user: this.toPublic(user),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.sessions.revokeByToken(refreshToken);
  }

  toPublic(user: User): AuthedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
