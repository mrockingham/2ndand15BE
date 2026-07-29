import { rateLimit } from 'express-rate-limit';

import type { AppConfig, RateLimitConfig } from '../../config/env.js';
import { serializeRequestId } from '../utils/request-id.js';

export function createApiRateLimiter(config: AppConfig['rateLimit']): ReturnType<typeof rateLimit> {
  return createRateLimiter(config);
}

export function createRateLimiter(config: RateLimitConfig): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          requestId: serializeRequestId(request.id),
        },
      });
    },
  });
}
