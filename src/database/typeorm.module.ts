import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { dataSourceOptions } from './data-source';
import { HealthService } from '../modules/health/health.service';
import { DataSource } from 'typeorm';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ...dataSourceOptions,
        url: config.databaseUrl,
        logging: config.isProduction ? ['error', 'warn'] : ['error', 'warn'],
        autoLoadEntities: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {
  constructor(dataSource: DataSource, health: HealthService) {
    health.register('postgres', async () => {
      const start = Date.now();
      await dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    });
  }
}
