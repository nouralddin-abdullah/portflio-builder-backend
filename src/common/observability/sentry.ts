import * as Sentry from '@sentry/node';
import type { AppConfigService } from '../../config/config.service';

let initialized = false;

export function initSentry(config: AppConfigService): void {
  if (initialized) return;
  const dsn = config.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.sentryTracesSampleRate,
  });
  initialized = true;
}

export { Sentry };
