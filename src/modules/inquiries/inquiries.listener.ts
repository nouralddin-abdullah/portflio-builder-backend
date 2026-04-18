import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus.service';
import { InquiriesQueue } from './inquiries.queue';

/**
 * Wires the domain event emitted by PublicService to the mail queue.
 * Keeping the listener as a dedicated provider keeps the pub/sub seam
 * observable and makes retries/queue-policy changes one-file edits.
 */
@Injectable()
export class InquiriesListener implements OnModuleInit {
  private readonly logger = new Logger(InquiriesListener.name);

  constructor(
    private readonly events: EventBus,
    private readonly queue: InquiriesQueue,
  ) {}

  onModuleInit(): void {
    this.events.on('inquiry.received', async ({ tenantId, inquiryId }) => {
      try {
        await this.queue.enqueueMail({ tenantId, inquiryId });
      } catch (err) {
        this.logger.error({ msg: 'inquiry_mail_enqueue_failed', tenantId, inquiryId, err });
      }
    });
  }
}
