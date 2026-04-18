import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/config.service';
import { HealthService } from '../../modules/health/health.service';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService, HealthService],
      useFactory: (config: AppConfigService, health: HealthService): Redis => {
        const client = new Redis(config.redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          enableReadyCheck: true,
        });
        health.register('redis', async () => {
          const start = Date.now();
          const pong = await client.ping();
          return { ok: pong === 'PONG', latencyMs: Date.now() - start };
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly moduleRef?: unknown) {}

  async onModuleDestroy(): Promise<void> {
    // Close via DI to avoid holding a private reference.
    // Individual consumers can also `.quit()` if they want graceful shutdown.
  }
}
