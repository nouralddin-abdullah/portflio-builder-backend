import type { RateLimitRule } from '../../common/rate-limit/rate-limit.service';

/** 5 inquiries per IP per hour. */
export const INQUIRY_IP_RULE: RateLimitRule = {
  key: 'public:inquiry:ip',
  limit: 5,
  windowSec: 60 * 60,
};

/** 100 inquiries per tenant per hour. */
export const INQUIRY_TENANT_RULE: RateLimitRule = {
  key: 'public:inquiry:tenant',
  limit: 100,
  windowSec: 60 * 60,
};

/** 60 pageviews per IP per minute — generous enough for a human, tight enough for a bot. */
export const PAGEVIEW_IP_RULE: RateLimitRule = {
  key: 'public:pageview:ip',
  limit: 60,
  windowSec: 60,
};
