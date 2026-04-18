import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { InquiriesService } from './inquiries.service';
import type {
  InquiryDetail,
  PaginatedInquiries,
} from './inquiries.service';
import { ListQueryDto } from './schemas';

@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get()
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query() q: ListQueryDto,
  ): Promise<PaginatedInquiries> {
    return this.inquiries.list(principal.userId, {
      cursor: q.cursor,
      limit: q.limit,
      unread: q.unread,
    });
  }

  @Get(':id')
  detail(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<InquiryDetail> {
    return this.inquiries.detail(principal.userId, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<InquiryDetail> {
    return this.inquiries.markRead(principal.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    return this.inquiries.delete(principal.userId, id);
  }
}
