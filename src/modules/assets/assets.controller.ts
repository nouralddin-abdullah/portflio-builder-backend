import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssetsService } from './assets.service';
import type { AssetSummary } from './assets.service';
import { ConfirmDto, SignDto } from './schemas';
import type { PresignedPut } from './r2.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post('sign')
  @HttpCode(HttpStatus.OK)
  sign(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: SignDto,
  ): Promise<PresignedPut & { maxBytes: number }> {
    return this.assets.sign(principal.userId, body);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  confirm(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: ConfirmDto,
  ): Promise<AssetSummary> {
    return this.assets.confirm(principal.userId, body.key);
  }

  @Get()
  list(@CurrentUser() principal: AuthPrincipal): Promise<AssetSummary[]> {
    return this.assets.list(principal.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    await this.assets.delete(principal.userId, id);
  }
}
