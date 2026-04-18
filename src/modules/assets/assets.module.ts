import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Asset } from '../../database/entities/asset.entity';
import { Portfolio } from '../../database/entities/portfolio.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { R2Service } from './r2.service';
import { AssetsQueue } from './assets.queue';
import { AssetsProcessor } from './assets-process.processor';

@Module({
  imports: [TypeOrmModule.forFeature([Asset, Portfolio, Tenant])],
  controllers: [AssetsController],
  providers: [AssetsService, R2Service, AssetsQueue, AssetsProcessor],
  exports: [AssetsService, R2Service],
})
export class AssetsModule {}
