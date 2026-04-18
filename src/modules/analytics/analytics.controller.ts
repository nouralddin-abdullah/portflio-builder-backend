import { Controller, Get, Query } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import type { OverviewResponse, TopItem } from './analytics.service';
import {
  CountriesQueryDto,
  OverviewQueryDto,
  ReferrersQueryDto,
  TopPagesQueryDto,
} from './schemas';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: OverviewQueryDto,
  ): Promise<OverviewResponse> {
    return this.analytics.overview(principal.userId, q.range);
  }

  @Get('top-pages')
  topPages(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: TopPagesQueryDto,
  ): Promise<TopItem[]> {
    return this.analytics.topPages(principal.userId, q.range, q.limit);
  }

  @Get('referrers')
  referrers(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: ReferrersQueryDto,
  ): Promise<TopItem[]> {
    return this.analytics.referrers(principal.userId, q.range, q.limit);
  }

  @Get('countries')
  countries(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: CountriesQueryDto,
  ): Promise<TopItem[]> {
    return this.analytics.countries(principal.userId, q.range, q.limit);
  }
}
