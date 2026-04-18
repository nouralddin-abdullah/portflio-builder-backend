import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema, type Env } from './env.schema';
import { AppConfigService } from './config.service';

function loadEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`[config] invalid environment:\n${issues}`);
  }
  return parsed.data;
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [
    {
      provide: AppConfigService,
      useFactory: () => new AppConfigService(loadEnv(process.env)),
    },
  ],
  exports: [AppConfigService],
})
export class AppConfigModule {}
