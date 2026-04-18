import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import jwt, { type Algorithm, type JwtPayload as BaseJwtPayload } from 'jsonwebtoken';
import { AppConfigService } from '../../config/config.service';

const ALG: Algorithm = 'RS256';

export interface AccessTokenClaims extends BaseJwtPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: string;
  private publicKey!: string;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const { privateKeyPath, publicKeyPath } = this.config.jwt;
    this.privateKey = readFileSync(privateKeyPath, 'utf8');
    this.publicKey = readFileSync(publicKeyPath, 'utf8');
  }

  signAccess(userId: string, sessionId: string): string {
    return jwt.sign({ sub: userId, sid: sessionId }, this.privateKey, {
      algorithm: ALG,
      expiresIn: this.config.jwt.accessTtlSec,
    });
  }

  verifyAccess(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.publicKey, { algorithms: [ALG] });
      if (typeof payload === 'string' || !payload.sub || !('sid' in payload)) {
        throw new Error('malformed access token');
      }
      return payload as AccessTokenClaims;
    } catch {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'Invalid access token.' });
    }
  }

  /** 256 bits of URL-safe randomness, hashed with sha256 before persistence. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
