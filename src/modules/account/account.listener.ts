import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus.service';
import { AccountService } from './account.service';

/**
 * Subscribes to cross-module user-lifecycle events and forwards them
 * into the AccountService mail pipeline.
 *   - `user.registered` → send the initial email_verify mail
 *   - `user.email_change_requested` → send the email_change confirmation
 */
@Injectable()
export class AccountListener implements OnModuleInit {
  private readonly logger = new Logger(AccountListener.name);

  constructor(
    private readonly events: EventBus,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.events.on('user.registered', async ({ userId }) => {
      try {
        await this.account.requestEmailVerification(userId);
      } catch (err) {
        this.logger.error({ msg: 'registration_verify_enqueue_failed', userId, err });
      }
    });

    this.events.on('user.email_change_requested', async (payload) => {
      try {
        await this.account.dispatchEmailChangeMail({
          userId: payload.userId,
          tokenId: payload.tokenId,
          newEmail: payload.newEmail,
          rawToken: payload.rawToken,
        });
      } catch (err) {
        this.logger.error({ msg: 'email_change_mail_enqueue_failed', userId: payload.userId, err });
      }
    });
  }
}
