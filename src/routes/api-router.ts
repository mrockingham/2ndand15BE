import { Router, type RequestHandler } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { createApiRateLimiter } from '../common/middleware/rate-limit.js';
import type { AppConfig } from '../config/env.js';
import { openApiDocument } from '../docs/openapi.js';
import type { HealthControllerOptions } from '../modules/health/health.controller.js';
import { createGameRouter, createTeamGameRouter } from '../modules/games/game.routes.js';
import type { GameReader } from '../modules/games/game.service.js';
import { createHealthRouter } from '../modules/health/health.routes.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import type { AuthenticationService } from '../modules/auth/auth.service.js';
import { createTeamRouter } from '../modules/teams/team.routes.js';
import type { TeamReader } from '../modules/teams/team.service.js';
import { createUserRouter } from '../modules/users/user.routes.js';
import type { UserPersonalizationService } from '../modules/users/user.service.js';

export interface ApiRouterOptions {
  readonly rateLimit: AppConfig['rateLimit'];
  readonly health?: HealthControllerOptions;
  readonly teamReader: TeamReader;
  readonly gameReader: GameReader;
  readonly authService: AuthenticationService;
  readonly userService: UserPersonalizationService;
  readonly authenticate: RequestHandler;
  readonly authConfig: AppConfig['auth'];
  readonly passwordResetConfig: AppConfig['passwordReset'];
}

export function createApiRouter(options: ApiRouterOptions): Router {
  const router = Router();

  router.use(createApiRateLimiter(options.rateLimit));
  router.get('/docs/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });
  router.use(
    '/docs',
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument),
  );
  router.use('/health', createHealthRouter(options.health));
  router.use('/games', createGameRouter(options.gameReader));
  router.use('/teams/:teamId/games', createTeamGameRouter(options.gameReader));
  router.use('/teams', createTeamRouter(options.teamReader));
  router.use(
    '/auth',
    createAuthRouter({
      authService: options.authService,
      cookie: options.authConfig.cookie,
      refreshTokenTtlSeconds: options.authConfig.refreshTokenTtlSeconds,
      authRateLimit: options.authConfig.rateLimit,
      passwordResetRateLimit: options.passwordResetConfig.rateLimit,
    }),
  );
  router.use(
    '/users',
    createUserRouter(options.authService, options.userService, options.authenticate),
  );

  return router;
}
