import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import type { AuthResponse } from '../auth/auth.service';
import { OAuthService } from './oauth.service';
import { CallbackQueryDto, ExchangeDto, ProviderParamDto } from './schemas';

@Public()
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get(':provider')
  async begin(
    @Param() params: ProviderParamDto,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.oauth.beginFlow(params.provider, returnTo);
    res.redirect(302, redirectUrl);
  }

  @Get(':provider/callback')
  async callback(
    @Param() params: ProviderParamDto,
    @Query() q: CallbackQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.oauth.handleCallback(params.provider, q.code, q.state);
    res.redirect(302, redirectUrl);
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  exchange(@Body() body: ExchangeDto, @Req() req: Request): Promise<AuthResponse> {
    return this.oauth.exchangeOtcForSession(body.code, this.ctxOf(req));
  }

  private ctxOf(req: Request): { userAgent?: string | null; ip?: string | null } {
    const ua = req.headers['user-agent'];
    const fwd = req.headers['x-forwarded-for'];
    const ip =
      typeof fwd === 'string' && fwd.length > 0
        ? fwd.split(',')[0]?.trim()
        : (req.ip ?? req.socket.remoteAddress ?? null);
    return {
      userAgent: typeof ua === 'string' ? ua : null,
      ip: ip ?? null,
    };
  }
}
