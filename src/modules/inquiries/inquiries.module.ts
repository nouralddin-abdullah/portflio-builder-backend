import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inquiry } from '../../database/entities/inquiry.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { User } from '../../database/entities/user.entity';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { InquiriesQueue } from './inquiries.queue';
import { InquiriesListener } from './inquiries.listener';
import { InquiriesMailProcessor } from './inquiries-mail.processor';
import { MailService } from './mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([Inquiry, Tenant, User])],
  controllers: [InquiriesController],
  providers: [
    InquiriesService,
    InquiriesQueue,
    InquiriesListener,
    InquiriesMailProcessor,
    MailService,
  ],
  exports: [MailService],
})
export class InquiriesModule {}
