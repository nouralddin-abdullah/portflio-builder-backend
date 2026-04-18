import { Injectable } from '@nestjs/common';

export interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthCheck {
  name: string;
  check: () => Promise<CheckResult>;
}

/**
 * Health checks are registered by feature modules via `HealthService.register()`.
 * Until DB/Redis/R2 modules land (T2+), readiness only reports the process itself.
 */
@Injectable()
export class HealthService {
  private readonly checks = new Map<string, HealthCheck['check']>();

  register(name: string, check: HealthCheck['check']): void {
    this.checks.set(name, check);
  }

  async runReadinessChecks(): Promise<Record<string, CheckResult>> {
    const results: Record<string, CheckResult> = {};
    await Promise.all(
      Array.from(this.checks.entries()).map(async ([name, fn]) => {
        const start = Date.now();
        try {
          const res = await fn();
          results[name] = { ...res, latencyMs: res.latencyMs ?? Date.now() - start };
        } catch (err) {
          results[name] = {
            ok: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return results;
  }
}
