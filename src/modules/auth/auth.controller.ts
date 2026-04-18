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
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './schemas';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import {
  LOGIN_EMAIL_RULE,
  LOGIN_IP_RULE,
  REFRESH_IP_RULE,
  REGISTER_IP_RULE,
} from './rate-limits';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('register')
  async register(@Body() body: RegisterDto, @Req() req: Request) {
    await this.enforce(REGISTER_IP_RULE, this.ipOf(req));
    return this.auth.register(body, this.contextOf(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const ip = this.ipOf(req);
    await this.enforce(LOGIN_IP_RULE, ip);
    await this.enforce(LOGIN_EMAIL_RULE, body.email.trim().toLowerCase());
    return this.auth.login(body, this.contextOf(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto, @Req() req: Request) {
    await this.enforce(REFRESH_IP_RULE, this.ipOf(req));
    return this.auth.refresh(body.refreshToken, this.contextOf(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
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
    // trust_proxy-aware IP; falls back to socket.
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }

  private contextOf(req: Request): { userAgent?: string | null; ip?: string | null } {
    const ua = req.headers['user-agent'];
    return {
      userAgent: typeof ua === 'string' ? ua : null,
      ip: this.ipOf(req),
    };
  }
}
