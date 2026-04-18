import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PortfoliosService } from './portfolios.service';
import type { PaginatedRevisions, PortfolioSummary } from './portfolios.service';
import { RevisionsQueryDto, SettingsDto } from './schemas';

@Controller('portfolio')
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Get()
  get(@CurrentUser() principal: AuthPrincipal): Promise<PortfolioSummary> {
    return this.portfolios.getForUser(principal.userId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: SettingsDto,
  ): Promise<PortfolioSummary> {
    return this.portfolios.updateSettings(principal.userId, body);
  }

  @Put('section/:kind')
  upsertSection(
    @CurrentUser() principal: AuthPrincipal,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ): Promise<PortfolioSummary> {
    return this.portfolios.upsertSection(principal.userId, kind, body);
  }

  @Delete('section/:kind')
  deleteSection(
    @CurrentUser() principal: AuthPrincipal,
    @Param('kind') kind: string,
  ): Promise<PortfolioSummary> {
    return this.portfolios.deleteSection(principal.userId, kind);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() principal: AuthPrincipal): Promise<PortfolioSummary> {
    return this.portfolios.publish(principal.userId);
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentUser() principal: AuthPrincipal): Promise<PortfolioSummary> {
    return this.portfolios.unpublish(principal.userId);
  }

  @Get('revisions')
  listRevisions(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: RevisionsQueryDto,
  ): Promise<PaginatedRevisions> {
    return this.portfolios.listRevisions(principal.userId, q.cursor, q.limit ?? 20);
  }

  @Post('revisions/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreRevision(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<PortfolioSummary> {
    return this.portfolios.restoreRevision(principal.userId, id);
  }
}
