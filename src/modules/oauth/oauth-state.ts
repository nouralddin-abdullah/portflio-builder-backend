import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthProvider } from '../../database/entities/oauth-account.entity';

export interface OAuthStatePayload {
  provider: OAuthProvider;
  nonce: string;
  issuedAt: number;
  returnTo?: string;
}

const TTL_MS = 10 * 60 * 1_000;

/**
 * Opaque, signed, self-describing state token. We don't need server-side
 * storage for the short-lived hop to the provider and back — a tampered
 * state fails HMAC verification and is rejected.
 */
export class OAuthStateCodec {
  constructor(private readonly secret: string) {}

  issue(provider: OAuthProvider, returnTo?: string): string {
    const payload: OAuthStatePayload = {
      provider,
      nonce: randomBytes(12).toString('base64url'),
      issuedAt: Date.now(),
      returnTo,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = this.hmac(body);
    return `${body}.${mac}`;
  }

  verify(raw: string): OAuthStatePayload {
    const [body, mac] = raw.split('.');
    if (!body || !mac) throw new Error('state_malformed');
    const expected = this.hmac(body);
    const presented = Buffer.from(mac);
    const canon = Buffer.from(expected);
    if (presented.length !== canon.length || !timingSafeEqual(presented, canon)) {
      throw new Error('state_signature');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthStatePayload;
    if (Date.now() - payload.issuedAt > TTL_MS) throw new Error('state_expired');
    return payload;
  }

  private hmac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
