import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Portfolio } from '../../database/entities/portfolio.entity';
import { PortfolioRevision } from '../../database/entities/portfolio-revision.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';

@Module({
  imports: [TypeOrmModule.forFeature([Portfolio, PortfolioRevision, Tenant])],
  controllers: [PortfoliosController],
  providers: [PortfoliosService],
  exports: [PortfoliosService],
})
export class PortfoliosModule {}
