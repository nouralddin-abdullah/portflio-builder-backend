import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainVerification } from '../../database/entities/domain-verification.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { DomainsQueue } from './domains.queue';
import { DomainsVerifyProcessor } from './domains-verify.processor';
import { DohService } from './doh.service';

@Module({
  imports: [TypeOrmModule.forFeature([DomainVerification, Tenant])],
  controllers: [DomainsController],
  providers: [DomainsService, DomainsQueue, DomainsVerifyProcessor, DohService],
  exports: [DomainsService],
})
export class DomainsModule {}
