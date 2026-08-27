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
import type { AdministrativeIdentityReader } from './modules/admin/admin-authorization.js';
import type { AdministrativeScheduleService } from './modules/admin/admin.service.js';
import type { DataHealthServiceContract } from './modules/data-health/data-health.service.js';
import type { GameHighlightsServiceContract } from './modules/game-highlights/game-highlights.service.js';
import type { GameMediaCurationServiceContract } from './modules/game-media-curation/game-media-curation.service.js';
import type { HomepageServiceContract } from './modules/homepage/homepage.service.js';
import type {
  EditorialArticleService,
  PublicArticleReader,
} from './modules/articles/article.service.js';
import type { HealthControllerOptions } from './modules/health/health.controller.js';
import type { GameReader } from './modules/games/game.service.js';
import type { GameStatsReader } from './modules/game-stats/game-stats.service.js';
import type { GamePlayReader } from './modules/game-plays/game-plays.service.js';
import type { TeamReader } from './modules/teams/team.service.js';
import type { UserPersonalizationService } from './modules/users/user.service.js';
import { createApiRouter } from './routes/api-router.js';
import type { NewsInboxServiceContract } from './modules/news-inbox/news.service.js';
import type { PlayerReader } from './modules/players/player.service.js';
import type { StatsHubReader } from './modules/stats-hub/stats.service.js';
import type { TeamHubReader } from './modules/team-hub/team-hub.service.js';
import type { EditorialAiServiceContract } from './modules/editorial-ai/editorial-ai.service.js';
import type { PredictionService } from './modules/ai-hub/prediction.service.js';
import type { AiHubWeeklyInsightsService } from './modules/ai-hub/weekly-insights.service.js';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly logger?: Logger;
  readonly health?: HealthControllerOptions;
  readonly teamReader: TeamReader;
  readonly gameReader: GameReader;
  readonly gameStatsReader?: GameStatsReader;
  readonly gamePlayReader?: GamePlayReader;
  readonly authService: AuthenticationService;
  readonly userService: UserPersonalizationService;
  readonly accessTokens: AccessTokenService;
  readonly adminService?: AdministrativeScheduleService;
  readonly adminIdentities?: AdministrativeIdentityReader;
  readonly dataHealthService?: DataHealthServiceContract;
  readonly gameHighlightsService?: GameHighlightsServiceContract;
  readonly gameMediaCurationService?: GameMediaCurationServiceContract;
  readonly homepageService?: HomepageServiceContract;
  readonly articleReader?: PublicArticleReader;
  readonly editorialArticleService?: EditorialArticleService;
  readonly newsInboxService?: NewsInboxServiceContract;
  readonly playerReader?: PlayerReader;
  readonly statsHubReader?: StatsHubReader;
  readonly teamHubReader?: TeamHubReader;
  readonly editorialAiService?: EditorialAiServiceContract;
  readonly predictionService?: PredictionService;
  readonly weeklyInsightsService?: AiHubWeeklyInsightsService;
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
      ...(options.gameStatsReader === undefined
        ? {}
        : { gameStatsReader: options.gameStatsReader }),
      ...(options.gamePlayReader === undefined ? {} : { gamePlayReader: options.gamePlayReader }),
      authService: options.authService,
      userService: options.userService,
      authenticate: createAuthenticationMiddleware(options.accessTokens),
      authConfig: options.config.auth,
      passwordResetConfig: options.config.passwordReset,
      ...(options.adminService === undefined ? {} : { adminService: options.adminService }),
      ...(options.adminIdentities === undefined
        ? {}
        : { adminIdentities: options.adminIdentities }),
      ...(options.dataHealthService === undefined
        ? {}
        : { dataHealthService: options.dataHealthService }),
      ...(options.gameHighlightsService === undefined
        ? {}
        : { gameHighlightsService: options.gameHighlightsService }),
      ...(options.gameMediaCurationService === undefined
        ? {}
        : { gameMediaCurationService: options.gameMediaCurationService }),
      ...(options.homepageService === undefined
        ? {}
        : { homepageService: options.homepageService }),
      ...(options.articleReader === undefined ? {} : { articleReader: options.articleReader }),
      ...(options.editorialArticleService === undefined
        ? {}
        : { editorialArticleService: options.editorialArticleService }),
      ...(options.newsInboxService === undefined
        ? {}
        : { newsInboxService: options.newsInboxService }),
      ...(options.playerReader === undefined ? {} : { playerReader: options.playerReader }),
      ...(options.statsHubReader === undefined ? {} : { statsHubReader: options.statsHubReader }),
      ...(options.teamHubReader === undefined ? {} : { teamHubReader: options.teamHubReader }),
      ...(options.editorialAiService === undefined
        ? {}
        : { editorialAiService: options.editorialAiService }),
      ...(options.predictionService === undefined
        ? {}
        : { predictionService: options.predictionService }),
      ...(options.weeklyInsightsService === undefined
        ? {}
        : { weeklyInsightsService: options.weeklyInsightsService }),
      ...(options.health === undefined ? {} : { health: options.health }),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
