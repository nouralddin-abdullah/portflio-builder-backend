import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { config as loadDotenv } from 'dotenv';
import { ALL_ENTITIES } from './entities';

// CLI commands (migration:run, migration:generate) import this file directly;
// the Nest app never starts with a `.env` that hasn't already been loaded,
// but the CLI needs it here.
loadDotenv({ path: '.env.local' });
loadDotenv();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [...ALL_ENTITIES],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsRun: false,
  synchronize: false,
  logging: ['error', 'warn'],
  extra: { max: 10, connectionTimeoutMillis: 5000 },
};

export const AppDataSource = new DataSource(dataSourceOptions);
