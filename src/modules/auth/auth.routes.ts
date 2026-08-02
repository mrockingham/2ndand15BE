import { Router } from 'express';

import { createRateLimiter } from '../../common/middleware/rate-limit.js';
import type { RateLimitConfig } from '../../config/env.js';
import { createAuthController } from './auth.controller.js';
import type { AuthenticationService } from './auth.service.js';
import type { RefreshCookieConfig } from '../../common/http/refresh-cookie.js';

export interface AuthRouterOptions {
  readonly authService: AuthenticationService;
  readonly cookie: RefreshCookieConfig;
  readonly refreshTokenTtlSeconds: number;
  readonly authRateLimit: RateLimitConfig;
  readonly passwordResetRateLimit: RateLimitConfig;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const controller = createAuthController(options);
  const credentialLimiter = createRateLimiter(options.authRateLimit);
  const passwordResetLimiter = createRateLimiter(options.passwordResetRateLimit);

  router.post('/register', credentialLimiter, controller.register);
  router.post('/login', credentialLimiter, controller.login);
  router.post('/refresh', credentialLimiter, controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/forgot-password', passwordResetLimiter, controller.forgotPassword);
  router.post('/reset-password', passwordResetLimiter, controller.resetPassword);

  return router;
}
