import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import { createLogger } from './common/logging/logger.js';
import { createAuthenticationMiddleware } from './common/middleware/authenticate.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { notFoundHandler } from './common/middleware/not-found.js';
import { createRequestLogger } from './common/middleware/request-logger.js';
import type { AppConfig } from './config/env.js';
import type { AccessTokenService } from './common/security/access-token.js';
import type { AuthenticationService } from './modules/auth/auth.service.js';
import type { HealthControllerOptions } from './modules/health/health.controller.js';
import type { GameReader } from './modules/games/game.service.js';
import type { TeamReader } from './modules/teams/team.service.js';
import type { UserPersonalizationService } from './modules/users/user.service.js';
import { createApiRouter } from './routes/api-router.js';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger?: Logger;
  readonly health?: HealthControllerOptions;
  readonly teamReader: TeamReader;
  readonly gameReader: GameReader;
  readonly authService: AuthenticationService;
  readonly userService: UserPersonalizationService;
  readonly accessTokens: AccessTokenService;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const logger = options.logger ?? createLogger(options.config);

  app.disable('x-powered-by');
  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin: [...options.config.corsOrigins],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/api/v1',
    createApiRouter({
      rateLimit: options.config.rateLimit,
      teamReader: options.teamReader,
      gameReader: options.gameReader,
      authService: options.authService,
      userService: options.userService,
      authenticate: createAuthenticationMiddleware(options.accessTokens),
      authConfig: options.config.auth,
      passwordResetConfig: options.config.passwordReset,
      ...(options.health === undefined ? {} : { health: options.health }),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
