import type { Redis as RedisClient } from 'ioredis';
import { RateLimitService } from './rate-limit.service';

type RedisLike = {
  incr: jest.Mock<Promise<number>, [string]>;
  expire: jest.Mock<Promise<number>, [string, number]>;
  ttl: jest.Mock<Promise<number>, [string]>;
  del: jest.Mock<Promise<number>, [string]>;
};

function makeRedis(): RedisLike {
  return {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(60),
    del: jest.fn().mockResolvedValue(1),
  };
}

describe('RateLimitService', () => {
  const rule = { key: 'test:x', limit: 3, windowSec: 60 };

  it('first hit initialises the window and is allowed', async () => {
    const redis = makeRedis();
    redis.incr.mockResolvedValueOnce(1);
    const svc = new RateLimitService(redis as unknown as RedisClient);
    const res = await svc.hit(rule, 'abc');
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(2);
    expect(redis.expire).toHaveBeenCalledWith('test:x:abc', 60);
  });

  it('does not re-apply expire after the first hit', async () => {
    const redis = makeRedis();
    redis.incr.mockResolvedValueOnce(2);
    const svc = new RateLimitService(redis as unknown as RedisClient);
    await svc.hit(rule, 'abc');
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('denies once count exceeds the limit', async () => {
    const redis = makeRedis();
    redis.incr.mockResolvedValueOnce(4);
    const svc = new RateLimitService(redis as unknown as RedisClient);
    const res = await svc.hit(rule, 'abc');
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('reset deletes the counter', async () => {
    const redis = makeRedis();
    const svc = new RateLimitService(redis as unknown as RedisClient);
    await svc.reset(rule, 'abc');
    expect(redis.del).toHaveBeenCalledWith('test:x:abc');
  });
});
