import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../database/entities/tenant.entity';
import { Portfolio } from '../../database/entities/portfolio.entity';
import { Inquiry } from '../../database/entities/inquiry.entity';
import { PageView } from '../../database/entities/page-view.entity';
import { User } from '../../database/entities/user.entity';
import { RateLimitModule } from '../../common/rate-limit/rate-limit.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ConfigCacheService } from './config-cache.service';
import { HCaptchaService } from './hcaptcha.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, Portfolio, Inquiry, PageView, User]),
    RateLimitModule,
  ],
  controllers: [PublicController],
  providers: [PublicService, ConfigCacheService, HCaptchaService],
  exports: [PublicService, ConfigCacheService],
})
export class PublicModule {}
