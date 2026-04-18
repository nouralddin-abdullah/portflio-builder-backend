import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthPrincipal } from '../auth/current-user.decorator';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { PASSWORD_RESET_EMAIL_RULE } from '../auth/rate-limits';
import { AccountService } from './account.service';
import { ForgotPasswordDto, ResetPasswordDto, TokenDto } from './schemas';

@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('email-verification/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestVerification(
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<{ status: 'sent' | 'already_verified' }> {
    const res = await this.account.requestEmailVerification(principal.userId);
    return { status: res.alreadyVerified ? 'already_verified' : 'sent' };
  }

  @Public()
  @Post('email-verification/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmVerification(@Body() body: TokenDto): Promise<void> {
    await this.account.confirmEmailVerification(body.token);
  }

  @Public()
  @Post('email-change/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmailChange(@Body() body: TokenDto): Promise<void> {
    await this.account.confirmEmailChange(body.token);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ status: 'ok' }> {
    const email = body.email.trim().toLowerCase();
    await this.enforce(PASSWORD_RESET_EMAIL_RULE, email);
    await this.enforce(PASSWORD_RESET_EMAIL_RULE, `ip:${this.ipOf(req)}`);
    await this.account.requestPasswordReset(email);
    // Always 202 regardless of whether the email exists.
    return { status: 'ok' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.account.resetPassword(body.token, body.newPassword);
  }

  private async enforce(rule: Parameters<RateLimitService['hit']>[0], subject: string) {
    const res = await this.rateLimit.hit(rule, subject);
    if (!res.allowed) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message: 'Too many requests. Please try again later.',
          details: { retryAfterSec: String(res.resetSec) },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private ipOf(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}
