import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface RateLimitRule {
  /** Human-readable key prefix, e.g. "auth:login:ip". */
  key: string;
  /** Max hits allowed in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

/**
 * Fixed-window counter in Redis. Keyed by `${rule.key}:${subject}`; a single
 * INCR + EXPIRE-if-new pair keeps ops cheap. Fixed-window is coarse but
 * adequate for the loads the spec calls for (tens of hits per window).
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = `${rule.key}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, rule.windowSec);
    }
    const ttl = await this.redis.ttl(key);
    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetSec: ttl > 0 ? ttl : rule.windowSec,
    };
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.redis.del(`${rule.key}:${subject}`);
  }
}
