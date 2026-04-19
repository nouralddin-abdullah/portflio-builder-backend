import { Injectable } from '@nestjs/common';
import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get port(): number {
    return this.env.PORT;
  }

  get logLevel(): string {
    return this.env.LOG_LEVEL;
  }

  get appOrigin(): string {
    return this.env.APP_ORIGIN;
  }

  get apiOrigin(): string {
    return this.env.API_ORIGIN;
  }

  get renderOriginSuffix(): string {
    return this.env.RENDER_ORIGIN_SUFFIX;
  }

  /** Static CORS origins. Render-origin matching against the suffix is handled dynamically. */
  get corsOrigins(): (string | RegExp)[] {
    const suffix = this.env.RENDER_ORIGIN_SUFFIX.replace(/\./g, '\\.');
    const renderPattern = new RegExp(`^https:\\/\\/[a-z0-9-]+${suffix}$`, 'i');
    return [this.env.APP_ORIGIN, renderPattern];
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  get jwt(): {
    privateKeyPath: string;
    publicKeyPath: string;
    accessTtlSec: number;
    refreshTtlSec: number;
  } {
    return {
      privateKeyPath: this.env.JWT_PRIVATE_KEY_PATH,
      publicKeyPath: this.env.JWT_PUBLIC_KEY_PATH,
      accessTtlSec: this.env.JWT_ACCESS_TTL_SEC,
      refreshTtlSec: this.env.REFRESH_TTL_SEC,
    };
  }

  get r2(): {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint: string;
    region: string;
    publicBaseUrl: string;
    presignTtlSec: number;
  } {
    return {
      accountId: this.env.R2_ACCOUNT_ID,
      accessKeyId: this.env.R2_ACCESS_KEY_ID,
      secretAccessKey: this.env.R2_SECRET_ACCESS_KEY,
      bucket: this.env.R2_BUCKET,
      endpoint: this.env.R2_ENDPOINT ?? '',
      region: this.env.R2_REGION,
      publicBaseUrl: this.env.R2_PUBLIC_BASE_URL ?? '',
      presignTtlSec: this.env.R2_PRESIGN_TTL_SEC,
    };
  }

  get mail(): { resendApiKey: string; from: string } {
    return {
      resendApiKey: this.env.RESEND_API_KEY,
      from: this.env.MAIL_FROM,
    };
  }

  get oauth(): {
    google: { clientId: string; clientSecret: string };
    github: { clientId: string; clientSecret: string };
  } {
    return {
      google: {
        clientId: this.env.GOOGLE_CLIENT_ID,
        clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: this.env.GITHUB_CLIENT_ID,
        clientSecret: this.env.GITHUB_CLIENT_SECRET,
      },
    };
  }

  get hcaptchaSecret(): string {
    return this.env.HCAPTCHA_SECRET;
  }

  get sentryDsn(): string {
    return this.env.SENTRY_DSN;
  }

  get sentryTracesSampleRate(): number {
    return this.env.SENTRY_TRACES_SAMPLE_RATE;
  }

  get sessionSalt(): string {
    return this.env.SESSION_SALT;
  }

  get analyticsSaltRotationCron(): string {
    return this.env.ANALYTICS_SALT_ROTATION_CRON;
  }

  get openapiEnabled(): boolean {
    return this.env.OPENAPI_ENABLED;
  }
}
