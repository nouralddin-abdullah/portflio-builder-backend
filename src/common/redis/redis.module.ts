import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/config.service';
import { HealthService } from '../../modules/health/health.service';

export const REDIS = Symbol('REDIS');

/** Separate token for BullMQ — ioredis keyPrefix is incompatible with BullMQ.
 *  Use BullMQ's own `prefix` option on Queue/Worker instead of relying on this. */
export const REDIS_BULLMQ = Symbol('REDIS_BULLMQ');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService, HealthService],
      useFactory: (config: AppConfigService, health: HealthService): Redis => {
        const client = new Redis(config.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          keyPrefix: config.redisKeyPrefix,
        });
        health.register('redis', async () => {
          const start = Date.now();
          const pong = await client.ping();
          return { ok: pong === 'PONG', latencyMs: Date.now() - start };
        });
        return client;
      },
    },
    {
      provide: REDIS_BULLMQ,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        }),
    },
  ],
  exports: [REDIS, REDIS_BULLMQ],
})
export class RedisModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    // Consumers can .quit() if they want graceful shutdown.
  }
}
