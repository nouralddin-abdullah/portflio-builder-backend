import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { DatabaseModule } from './database/typeorm.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { PortfoliosModule } from './modules/portfolios/portfolios.module';
import { AssetsModule } from './modules/assets/assets.module';
import { PublicModule } from './modules/public/public.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { DomainsModule } from './modules/domains/domains.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { EventsModule } from './common/events/events.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req, res) => {
            const existing = req.headers['x-request-id'];
            const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.current',
              'req.body.next',
              'req.body.token',
              'req.body.refreshToken',
              'req.body.accessToken',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req) => ({
            reqId: req.id,
          }),
          transport:
            config.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
        },
      }),
    }),
    HealthModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    PortfoliosModule,
    AssetsModule,
    PublicModule,
    InquiriesModule,
    DomainsModule,
    AnalyticsModule,
    OAuthModule,
    EventsModule,
  ],
})
export class AppModule {}
