import { AppDataSource } from '../data-source';
import { seedDev } from './dev.seed';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await seedDev(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed', err);
  process.exit(1);
});
