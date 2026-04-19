import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { User } from '../../database/entities/user.entity';
import {
  OAuthAccount,
  type OAuthProvider,
} from '../../database/entities/oauth-account.entity';
import { REDIS } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { SessionService } from '../auth/session.service';
import type { AuthResponse } from '../auth/auth.service';
import { AuthService } from '../auth/auth.service';
import { OAuthStateCodec } from './oauth-state';
import { PROVIDERS, type ProviderProfile } from './providers';

const OTC_TTL_SEC = 60;
const OTC_PREFIX = 'oauth:otc:';

export interface BeginFlowResult {
  redirectUrl: string;
}

export interface CallbackResult {
  redirectUrl: string;
}

interface OtcPayload {
  userId: string;
  createdAt: number;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly codec: OAuthStateCodec;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OAuthAccount) private readonly oauthAccounts: Repository<OAuthAccount>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfigService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {
    this.codec = new OAuthStateCodec(this.config.sessionSalt);
  }

  beginFlow(provider: OAuthProvider, returnTo?: string): Promise<BeginFlowResult> {
    return Promise.resolve().then(() => this.beginFlowSync(provider, returnTo));
  }

  private beginFlowSync(provider: OAuthProvider, returnTo?: string): BeginFlowResult {
    const creds = this.config.oauth[provider];
    if (!creds.clientId || !creds.clientSecret) {
      throw new BadRequestException({
        code: 'provider_not_configured',
        message: `OAuth for "${provider}" is not configured on this deployment.`,
      });
    }
    const def = PROVIDERS[provider];
    const state = this.codec.issue(provider, returnTo);
    const redirectUrl = def.authorizationUrl({
      clientId: creds.clientId,
      redirectUri: this.callbackUri(provider),
      state,
      scope: def.scope,
    });
    return { redirectUrl };
  }

  async handleCallback(
    provider: OAuthProvider,
    code: string,
    rawState: string,
  ): Promise<CallbackResult> {
    const payload = this.verifyState(rawState, provider);
    const tokens = await this.exchangeCodeForToken(provider, code);
    const profile = await PROVIDERS[provider].fetchProfile(tokens.access_token);
    const user = await this.linkOrCreate(provider, profile);
    const otc = await this.issueOneTimeCode(user.id);
    const target = this.resolveReturnTarget(payload.returnTo);
    target.searchParams.set('code', otc);
    target.searchParams.set('provider', provider);
    return { redirectUrl: target.toString() };
  }

  /**
   * Always routes through `/auth/oauth-complete` so the frontend callback page
   * can exchange the one-time code before handing control back to the app.
   * A sanitised `returnTo` (same-origin path) is forwarded as a secondary
   * param that the callback page uses for its final navigation. Direct
   * redirects to protected routes would bounce to /sign-in and burn the OTC.
   */
  private resolveReturnTarget(returnTo: string | undefined): URL {
    const base = this.config.appOrigin;
    const target = new URL('/auth/oauth-complete', base);
    if (!returnTo) return target;
    try {
      const resolved = new URL(returnTo, base);
      if (resolved.origin === new URL(base).origin) {
        target.searchParams.set('returnTo', `${resolved.pathname}${resolved.search}`);
      }
    } catch {
      // ignore malformed returnTo values; fall back to /auth/oauth-complete
    }
    return target;
  }

  async exchangeOtcForSession(
    code: string,
    ctx: { userAgent?: string | null; ip?: string | null },
  ): Promise<AuthResponse> {
    const key = `${OTC_PREFIX}${code}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new UnauthorizedException({
        code: 'otc_invalid',
        message: 'The sign-in code is invalid or has expired.',
      });
    }
    await this.redis.del(key); // one-time: atomic-enough; see docstring.
    let payload: OtcPayload;
    try {
      payload = JSON.parse(raw) as OtcPayload;
    } catch {
      throw new UnauthorizedException({ code: 'otc_invalid', message: 'Corrupt sign-in code.' });
    }
    const user = await this.users.findOne({ where: { id: payload.userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'otc_invalid', message: 'User not found.' });
    }
    const issued = await this.sessions.issue(user.id, ctx);
    return { ...issued, user: this.auth.toPublic(user) };
  }

  /** Resolves the redirect URI the provider will call back on. */
  callbackUri(provider: OAuthProvider): string {
    return `${this.config.apiOrigin}/api/oauth/${provider}/callback`;
  }

  private verifyState(rawState: string, expectedProvider: OAuthProvider) {
    try {
      const payload = this.codec.verify(rawState);
      if (payload.provider !== expectedProvider) {
        throw new Error('state_provider_mismatch');
      }
      return payload;
    } catch (err) {
      this.logger.warn({ msg: 'oauth_state_invalid', err });
      throw new UnauthorizedException({
        code: 'state_invalid',
        message: 'OAuth state is invalid or expired.',
      });
    }
  }

  private async exchangeCodeForToken(
    provider: OAuthProvider,
    code: string,
  ): Promise<{ access_token: string }> {
    const creds = this.config.oauth[provider];
    const def = PROVIDERS[provider];
    const body = def.buildTokenBody({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      code,
      redirectUri: this.callbackUri(provider),
    });
    const res = await fetch(def.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UnauthorizedException({
        code: 'token_exchange_failed',
        message: 'Failed to exchange the authorization code.',
        details: { status: String(res.status), body: text.slice(0, 200) },
      });
    }
    const json = (await res.json()) as { access_token?: string; error?: string };
    if (!json.access_token) {
      throw new UnauthorizedException({
        code: 'token_exchange_failed',
        message: 'Provider returned no access_token.',
        details: { error: json.error ?? 'unknown' },
      });
    }
    return { access_token: json.access_token };
  }

  /**
   * Links the OAuth identity to an existing user if the verified email
   * matches; otherwise creates a new user. Always upserts the
   * OAuthAccount row.
   */
  private async linkOrCreate(provider: OAuthProvider, profile: ProviderProfile): Promise<User> {
    const existingLink = await this.oauthAccounts.findOne({
      where: { provider, providerUid: profile.providerUid },
    });
    if (existingLink) {
      const user = await this.users.findOne({ where: { id: existingLink.userId } });
      if (!user) throw new Error('oauth_link_dangling_user');
      return user;
    }

    let user: User | null = null;
    if (profile.email && profile.emailVerified) {
      const email = profile.email.trim().toLowerCase();
      user = await this.users.findOne({ where: { email } });
    }

    if (!user) {
      user = this.users.create({
        email: (profile.email ?? `${profile.providerUid}@${provider}.oauth.local`).toLowerCase(),
        passwordHash: null,
        name: profile.name || 'Portfoli User',
        avatarUrl: profile.avatarUrl,
        headline: null,
        location: null,
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
      });
      await this.users.save(user);
    }

    const link = this.oauthAccounts.create({
      userId: user.id,
      provider,
      providerUid: profile.providerUid,
    });
    await this.oauthAccounts.save(link);
    return user;
  }

  private async issueOneTimeCode(userId: string): Promise<string> {
    const otc = randomBytes(24).toString('base64url');
    const payload: OtcPayload = { userId, createdAt: Date.now() };
    await this.redis.set(`${OTC_PREFIX}${otc}`, JSON.stringify(payload), 'EX', OTC_TTL_SEC);
    return otc;
  }
}
