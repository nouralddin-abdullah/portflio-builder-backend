import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    controller = moduleRef.get(HealthController);
    service = moduleRef.get(HealthService);
  });

  it('liveness returns ok', () => {
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('readiness returns ok when all checks pass', async () => {
    service.register('dummy', () => Promise.resolve({ ok: true }));
    const result = await controller.readiness();
    expect(result.status).toBe('ok');
    expect(result.checks.dummy?.ok).toBe(true);
  });

  it('readiness throws 503 when a check fails', async () => {
    service.register('dummy', () => Promise.resolve({ ok: false, error: 'boom' }));
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('readiness with zero registered checks is ok', async () => {
    const result = await controller.readiness();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({});
  });
});
