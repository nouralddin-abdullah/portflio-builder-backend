import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PublicService } from './public.service';
import type { RequestContext } from './public.service';
import type { PublicPortfolioConfig } from './config-cache.service';
import { ConfigQueryDto, InquiryDto, PageviewDto } from './schemas';
import { HCaptchaService } from './hcaptcha.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import {
  INQUIRY_IP_RULE,
  INQUIRY_TENANT_RULE,
  PAGEVIEW_IP_RULE,
} from './rate-limits';

@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly publicSvc: PublicService,
    private readonly hcaptcha: HCaptchaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('config')
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  config(@Query() q: ConfigQueryDto): Promise<PublicPortfolioConfig> {
    return this.publicSvc.resolveConfig(q.host);
  }

  @Post('inquiry')
  @HttpCode(HttpStatus.CREATED)
  async inquiry(@Body() body: InquiryDto, @Req() req: Request): Promise<{ id: string }> {
    const ip = this.ipOf(req);
    await this.enforce(INQUIRY_IP_RULE, ip);
    await this.enforce(INQUIRY_TENANT_RULE, body.tenantId);
    const captcha = await this.hcaptcha.verify(body.captchaToken, ip);
    if (!captcha.success) {
      throw new BadRequestException({
        code: 'captcha_failed',
        message: 'Captcha verification failed.',
        details: { reason: captcha.reason ?? 'unknown' },
      });
    }
    return this.publicSvc.submitInquiry(body, this.ctxOf(req, ip));
  }

  @Post('pageview')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pageview(@Body() body: PageviewDto, @Req() req: Request): Promise<void> {
    const ip = this.ipOf(req);
    await this.enforce(PAGEVIEW_IP_RULE, ip);
    await this.publicSvc.recordPageview(body, this.ctxOf(req, ip));
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

  private ctxOf(req: Request, ip: string): RequestContext {
    const ua = req.headers['user-agent'];
    const ref = req.headers.referer ?? req.headers.referrer;
    return {
      ip,
      userAgent: typeof ua === 'string' ? ua : null,
      referrer: typeof ref === 'string' ? ref : null,
    };
  }
}
