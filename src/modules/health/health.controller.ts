import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  @HttpCode(200)
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readiness(): Promise<{
    status: 'ok';
    checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
  }> {
    const checks = await this.health.runReadinessChecks();
    const allOk = Object.values(checks).every((c) => c.ok);
    if (!allOk) {
      throw new ServiceUnavailableException({
        code: 'not_ready',
        message: 'One or more dependencies are unavailable.',
        details: checks,
      });
    }
    return { status: 'ok', checks };
  }
}
