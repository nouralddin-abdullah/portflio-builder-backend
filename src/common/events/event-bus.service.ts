import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * Typed cross-module event hub. Zero-dep (builds on node:events) so we can
 * publish `portfolio.published` (cache-bust), `inquiry.received` (mail job),
 * etc. without pulling a dedicated dependency.
 *
 * Handlers are best-effort: a throw in one handler is logged and does not
 * abort the publisher — events must not be a back-channel for business
 * errors, they are informational.
 */
export interface AppEvents {
  'portfolio.published': { tenantId: string; portfolioId: string; subdomain: string; customDomain: string | null };
  'portfolio.unpublished': { tenantId: string; portfolioId: string; subdomain: string; customDomain: string | null };
  'inquiry.received': { tenantId: string; inquiryId: string };
  'asset.uploaded': { assetId: string };
  'asset.deleted': { assetId: string };
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void | Promise<void>;

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof AppEvents>(event: K, handler: Handler<K>): void {
    this.emitter.on(event, (payload: AppEvents[K]) => {
      void Promise.resolve(handler(payload)).catch((err: unknown) => {
        this.logger.error({ msg: 'event_handler_failed', event, err });
      });
    });
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}
