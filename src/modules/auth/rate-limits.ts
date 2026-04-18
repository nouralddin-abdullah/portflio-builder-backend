import type { RateLimitRule } from '../../common/rate-limit/rate-limit.service';

export const LOGIN_IP_RULE: RateLimitRule = {
  key: 'auth:login:ip',
  limit: 10,
  windowSec: 15 * 60,
};

export const LOGIN_EMAIL_RULE: RateLimitRule = {
  key: 'auth:login:email',
  limit: 5,
  windowSec: 15 * 60,
};

export const REGISTER_IP_RULE: RateLimitRule = {
  key: 'auth:register:ip',
  limit: 5,
  windowSec: 60 * 60,
};

export const PASSWORD_RESET_EMAIL_RULE: RateLimitRule = {
  key: 'auth:pwreset:email',
  limit: 3,
  windowSec: 60 * 60,
};

export const REFRESH_IP_RULE: RateLimitRule = {
  key: 'auth:refresh:ip',
  limit: 60,
  windowSec: 15 * 60,
};
