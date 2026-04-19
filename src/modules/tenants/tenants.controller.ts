import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantsService } from './tenants.service';
import type { SubdomainAvailability, TenantWithOwner } from './tenants.service';
import { SubdomainDto } from './schemas';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  get(@CurrentUser() principal: AuthPrincipal): Promise<TenantWithOwner> {
    return this.tenants.getOrCreateForUser(principal.userId);
  }

  @Get('subdomain/check')
  checkSubdomain(
    @CurrentUser() principal: AuthPrincipal,
    @Query('value') value: string | undefined,
  ): Promise<SubdomainAvailability> {
    return this.tenants.checkSubdomainAvailability(principal.userId, value ?? '');
  }

  @Post('subdomain')
  setSubdomain(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: SubdomainDto,
  ): Promise<TenantWithOwner> {
    return this.tenants.setSubdomain(principal.userId, body.subdomain);
  }
}
