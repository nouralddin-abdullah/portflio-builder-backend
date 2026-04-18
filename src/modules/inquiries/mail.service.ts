import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';

export interface MailMessage {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Thin Resend client. Uses the public REST endpoint directly via fetch to
 * avoid dragging the SDK into the worker footprint. In dev or when the API
 * key is unset we log-and-succeed so the local pipeline stays unblocked.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private static readonly ENDPOINT = 'https://api.resend.com/emails';

  constructor(private readonly config: AppConfigService) {}

  async send(msg: MailMessage): Promise<{ id: string | null }> {
    const { resendApiKey, from } = this.config.mail;
    if (!resendApiKey) {
      this.logger.warn({
        msg: 'mail_dry_run',
        to: msg.to,
        subject: msg.subject,
        reason: this.config.isProduction ? 'missing_api_key_in_prod' : 'dev_mode',
      });
      return { id: null };
    }
    const res = await fetch(MailService.ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: msg.from ?? from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`resend_send_failed status=${res.status} body=${errBody.slice(0, 200)}`);
    }
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? null };
  }
}
