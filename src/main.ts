import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { initSentry } from './common/observability/sentry';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { SerializationInterceptor } from './common/interceptors/serialization.interceptor';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(AppConfigService);
  initSentry(config);

  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
  });

  app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz', 'metrics'] });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.useGlobalInterceptors(new SerializationInterceptor());
  app.useGlobalPipes(new ZodValidationPipe());

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  logger.log(`Portfoli backend listening on :${config.port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] failed to start', err);
  process.exit(1);
});
