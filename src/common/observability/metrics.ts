import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Tiny Prometheus text-format `/metrics` endpoint. No `prom-client`
 * dependency — we only need process-level counters + queue sizes for the
 * oncall dashboard. If we grow into histograms/summaries we'll revisit.
 */
export function setupMetrics(app: INestApplication): void {
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance() as {
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  const startedAt = process.hrtime.bigint();

  instance.get('/metrics', (_req: Request, res: Response) => {
    const lines: string[] = [];
    const mem = process.memoryUsage();
    const uptimeSec = Number(process.hrtime.bigint() - startedAt) / 1e9;

    lines.push('# HELP portfoli_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE portfoli_uptime_seconds gauge');
    lines.push(`portfoli_uptime_seconds ${uptimeSec.toFixed(3)}`);

    lines.push('# HELP portfoli_process_resident_memory_bytes Resident set size.');
    lines.push('# TYPE portfoli_process_resident_memory_bytes gauge');
    lines.push(`portfoli_process_resident_memory_bytes ${mem.rss}`);

    lines.push('# HELP portfoli_process_heap_used_bytes Heap used.');
    lines.push('# TYPE portfoli_process_heap_used_bytes gauge');
    lines.push(`portfoli_process_heap_used_bytes ${mem.heapUsed}`);

    res.setHeader('content-type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  });
}
