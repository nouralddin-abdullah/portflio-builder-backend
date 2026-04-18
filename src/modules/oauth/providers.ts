import type { OAuthProvider } from '../../database/entities/oauth-account.entity';

export interface ProviderProfile {
  providerUid: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface OAuthProviderConfig {
  authorizationUrl(params: { clientId: string; redirectUri: string; state: string; scope: string }): string;
  tokenUrl: string;
  scope: string;
  buildTokenBody(params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): URLSearchParams;
  fetchProfile(accessToken: string): Promise<ProviderProfile>;
}

const GOOGLE: OAuthProviderConfig = {
  scope: 'openid email profile',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  authorizationUrl({ clientId, redirectUri, state, scope }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  },
  buildTokenBody({ clientId, clientSecret, code, redirectUri }): URLSearchParams {
    return new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
  },
  async fetchProfile(accessToken: string): Promise<ProviderProfile> {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`google_userinfo_status_${res.status}`);
    const json = (await res.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!json.sub) throw new Error('google_userinfo_missing_sub');
    return {
      providerUid: json.sub,
      email: json.email ?? null,
      name: (json.name ?? json.email ?? '').trim() || 'Google User',
      avatarUrl: json.picture ?? null,
      emailVerified: json.email_verified === true,
    };
  },
};

const GITHUB: OAuthProviderConfig = {
  scope: 'read:user user:email',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  authorizationUrl({ clientId, redirectUri, state, scope }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'true');
    return url.toString();
  },
  buildTokenBody({ clientId, clientSecret, code, redirectUri }): URLSearchParams {
    return new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
  },
  async fetchProfile(accessToken: string): Promise<ProviderProfile> {
    const [userRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'portfoli-backend',
        },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'portfoli-backend',
        },
      }),
    ]);
    if (!userRes.ok) throw new Error(`github_user_status_${userRes.status}`);
    const user = (await userRes.json()) as {
      id?: number;
      login?: string;
      name?: string | null;
      avatar_url?: string;
      email?: string | null;
    };
    if (typeof user.id !== 'number') throw new Error('github_user_missing_id');

    let email: string | null = user.email ?? null;
    let verified = Boolean(email);
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary?: boolean;
        verified?: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) {
        email = primary.email;
        verified = true;
      }
    }
    return {
      providerUid: String(user.id),
      email,
      name: (user.name ?? user.login ?? 'GitHub User').trim(),
      avatarUrl: user.avatar_url ?? null,
      emailVerified: verified,
    };
  },
};

export const PROVIDERS: Record<OAuthProvider, OAuthProviderConfig> = {
  google: GOOGLE,
  github: GITHUB,
};
