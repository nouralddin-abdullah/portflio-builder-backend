import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyStat } from '../../database/entities/daily-stat.entity';
import { PageView } from '../../database/entities/page-view.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueue } from './analytics.queue';
import { AnalyticsRollupProcessor } from './analytics-rollup.processor';

@Module({
  imports: [TypeOrmModule.forFeature([DailyStat, PageView, Tenant])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsQueue, AnalyticsRollupProcessor],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
