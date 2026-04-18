import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';

export interface CaptchaVerification {
  success: boolean;
  reason?: string;
}

/**
 * hCaptcha server-side verifier. In dev when HCAPTCHA_SECRET is unset we
 * allow the token through (with a warning) so local end-to-end flows work
 * without a live captcha — prod must configure the secret.
 */
@Injectable()
export class HCaptchaService {
  private readonly logger = new Logger(HCaptchaService.name);
  private static readonly VERIFY_URL = 'https://hcaptcha.com/siteverify';

  constructor(private readonly config: AppConfigService) {}

  async verify(token: string, remoteIp?: string): Promise<CaptchaVerification> {
    const secret = this.config.hcaptchaSecret;
    if (!secret) {
      if (this.config.isProduction) {
        return { success: false, reason: 'captcha_not_configured' };
      }
      this.logger.warn({ msg: 'hcaptcha_disabled_dev_only', token_len: token.length });
      return { success: true };
    }

    try {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.append('remoteip', remoteIp);
      const res = await fetch(HCaptchaService.VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
      if (!json.success) {
        return { success: false, reason: json['error-codes']?.join(',') ?? 'captcha_rejected' };
      }
      return { success: true };
    } catch (err) {
      this.logger.error({ msg: 'hcaptcha_verify_failed', err });
      return { success: false, reason: 'captcha_upstream_error' };
    }
  }
}
