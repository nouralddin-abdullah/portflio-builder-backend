import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { DomainsService } from './domains.service';
import type { DomainVerificationView } from './domains.service';
import { CustomDomainDto } from './schemas';

@Controller('tenant/custom-domain')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  list(@CurrentUser() principal: AuthPrincipal): Promise<DomainVerificationView[]> {
    return this.domains.listForUser(principal.userId);
  }

  @Post()
  request(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CustomDomainDto,
  ): Promise<DomainVerificationView> {
    return this.domains.requestVerification(principal.userId, body.domain);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CustomDomainDto,
  ): Promise<DomainVerificationView> {
    return this.domains.verify(principal.userId, body.domain);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  unbind(@CurrentUser() principal: AuthPrincipal): Promise<{ unbound: boolean }> {
    return this.domains.unbind(principal.userId);
  }
}
