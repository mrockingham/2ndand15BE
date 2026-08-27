import { Router, type RequestHandler } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { createApiRateLimiter } from '../common/middleware/rate-limit.js';
import type { AppConfig } from '../config/env.js';
import { createAdminRouter } from '../modules/admin/admin.routes.js';
import type { AdministrativeIdentityReader } from '../modules/admin/admin-authorization.js';
import type { AdministrativeScheduleService } from '../modules/admin/admin.service.js';
import { createDataHealthRouter } from '../modules/data-health/data-health.routes.js';
import type { DataHealthServiceContract } from '../modules/data-health/data-health.service.js';
import {
  createAdminArticleRouter,
  createPublicArticleRouter,
  createTeamArticleRouter,
} from '../modules/articles/article.routes.js';
import type {
  EditorialArticleService,
  PublicArticleReader,
} from '../modules/articles/article.service.js';
import { openApiDocument } from '../docs/openapi.js';
import type { HealthControllerOptions } from '../modules/health/health.controller.js';
import { createGameRouter, createTeamGameRouter } from '../modules/games/game.routes.js';
import type { GameReader } from '../modules/games/game.service.js';
import { createGameStatsRouter } from '../modules/game-stats/game-stats.routes.js';
import type { GameStatsReader } from '../modules/game-stats/game-stats.service.js';
import { createGamePlayRouter } from '../modules/game-plays/game-plays.routes.js';
import type { GamePlayReader } from '../modules/game-plays/game-plays.service.js';
import {
  createAdminGameHighlightsRouter,
  createPublicGameHighlightsRouter,
} from '../modules/game-highlights/game-highlights.routes.js';
import type { GameHighlightsServiceContract } from '../modules/game-highlights/game-highlights.service.js';
import {
  createAdminGameMediaCurationRouter,
  createPublicGameMediaRouter,
} from '../modules/game-media-curation/game-media-curation.routes.js';
import type { GameMediaCurationServiceContract } from '../modules/game-media-curation/game-media-curation.service.js';
import {
  createAdminHomepageRouter,
  createPublicHomepageRouter,
} from '../modules/homepage/homepage.routes.js';
import type { HomepageServiceContract } from '../modules/homepage/homepage.service.js';
import { createHealthRouter } from '../modules/health/health.routes.js';
import { createReadinessRouter } from '../modules/health/readiness.routes.js';
import type { ReadinessControllerOptions } from '../modules/health/readiness.controller.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import type { AuthenticationService } from '../modules/auth/auth.service.js';
import { createTeamRouter } from '../modules/teams/team.routes.js';
import type { TeamReader } from '../modules/teams/team.service.js';
import { createUserRouter } from '../modules/users/user.routes.js';
import type { UserPersonalizationService } from '../modules/users/user.service.js';
import { createNewsInboxRouters } from '../modules/news-inbox/news.routes.js';
import type { NewsInboxServiceContract } from '../modules/news-inbox/news.service.js';
import { createPlayerRouter } from '../modules/players/player.routes.js';
import type { PlayerReader } from '../modules/players/player.service.js';
import { createStatsHubRouter } from '../modules/stats-hub/stats.routes.js';
import type { StatsHubReader } from '../modules/stats-hub/stats.service.js';
import { createTeamHubRouter } from '../modules/team-hub/team-hub.routes.js';
import type { TeamHubReader } from '../modules/team-hub/team-hub.service.js';
import { createEditorialAiRouters } from '../modules/editorial-ai/editorial-ai.routes.js';
import type { EditorialAiServiceContract } from '../modules/editorial-ai/editorial-ai.service.js';
import { createPredictionRouters } from '../modules/ai-hub/prediction.routes.js';
import type { PredictionService } from '../modules/ai-hub/prediction.service.js';
import type { AiHubWeeklyInsightsService } from '../modules/ai-hub/weekly-insights.service.js';
import {
  createAdminContactRouter,
  createPublicContactRouter,
} from '../modules/contact/contact.routes.js';
import type { ContactServiceContract } from '../modules/contact/contact.service.js';

export interface ApiRouterOptions {
  readonly rateLimit: AppConfig['rateLimit'];
  readonly health?: HealthControllerOptions;
  readonly readiness?: ReadinessControllerOptions;
  readonly teamReader: TeamReader;
  readonly gameReader: GameReader;
  readonly gameStatsReader?: GameStatsReader;
  readonly gamePlayReader?: GamePlayReader;
  readonly authService: AuthenticationService;
  readonly userService: UserPersonalizationService;
  readonly authenticate: RequestHandler;
  readonly authConfig: AppConfig['auth'];
  readonly passwordResetConfig: AppConfig['passwordReset'];
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
  readonly contactService?: ContactServiceContract;
  readonly contactRateLimit?: AppConfig['contact']['rateLimit'];
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
  if (options.readiness !== undefined) {
    router.use('/ready', createReadinessRouter(options.readiness));
  }
  if (options.predictionService !== undefined && options.adminIdentities !== undefined) {
    const predictions = createPredictionRouters({
      authenticate: options.authenticate,
      identities: options.adminIdentities,
      service: options.predictionService,
      ...(options.weeklyInsightsService === undefined
        ? {}
        : { weeklyInsightsService: options.weeklyInsightsService }),
    });
    router.use('/ai-hub', predictions.publicRouter);
    router.use('/admin/predictions', predictions.adminRouter);
  }
  if (options.editorialAiService !== undefined && options.adminIdentities !== undefined) {
    const editorialAi = createEditorialAiRouters({
      authenticate: options.authenticate,
      identities: options.adminIdentities,
      service: options.editorialAiService,
    });
    router.use('/admin/news-candidates', editorialAi.candidates);
    router.use('/admin/articles', editorialAi.articles);
    router.use('/admin/editorial', editorialAi.editorial);
    router.use('/admin/news-sources', editorialAi.sources);
  }
  if (options.newsInboxService !== undefined && options.adminIdentities !== undefined) {
    const news = createNewsInboxRouters({
      authenticate: options.authenticate,
      identities: options.adminIdentities,
      service: options.newsInboxService,
      ingestionRateLimit: options.authConfig.rateLimit,
    });
    router.use('/admin/news-sources', news.sources);
    router.use('/admin/news-candidates', news.candidates);
  }
  if (options.editorialArticleService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/articles',
      createAdminArticleRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.editorialArticleService,
      }),
    );
  }
  if (options.adminService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin',
      createAdminRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.adminService,
        importRateLimit: options.authConfig.rateLimit,
      }),
    );
  }
  if (options.dataHealthService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/data-health',
      createDataHealthRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.dataHealthService,
      }),
    );
  }
  if (options.gameHighlightsService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/games',
      createAdminGameHighlightsRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.gameHighlightsService,
      }),
    );
  }
  if (options.gameMediaCurationService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/game-media',
      createAdminGameMediaCurationRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.gameMediaCurationService,
      }),
    );
  }
  if (options.homepageService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/homepage',
      createAdminHomepageRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.homepageService,
      }),
    );
  }
  if (options.contactService !== undefined && options.adminIdentities !== undefined) {
    router.use(
      '/admin/contact-messages',
      createAdminContactRouter({
        authenticate: options.authenticate,
        identities: options.adminIdentities,
        service: options.contactService,
      }),
    );
  }
  if (options.articleReader !== undefined) {
    router.use('/articles', createPublicArticleRouter(options.articleReader));
    router.use('/teams/:teamId/articles', createTeamArticleRouter(options.articleReader));
  }
  if (options.playerReader !== undefined)
    router.use('/players', createPlayerRouter(options.playerReader));
  if (options.statsHubReader !== undefined)
    router.use('/stats', createStatsHubRouter(options.statsHubReader));
  if (options.gameStatsReader !== undefined)
    router.use('/games', createGameStatsRouter(options.gameStatsReader));
  if (options.gamePlayReader !== undefined)
    router.use('/games', createGamePlayRouter(options.gamePlayReader));
  if (options.gameHighlightsService !== undefined)
    router.use('/games', createPublicGameHighlightsRouter(options.gameHighlightsService));
  if (options.gameMediaCurationService !== undefined)
    router.use('/games', createPublicGameMediaRouter(options.gameMediaCurationService));
  router.use('/games', createGameRouter(options.gameReader));
  router.use('/teams/:teamId/games', createTeamGameRouter(options.gameReader));
  if (options.teamHubReader !== undefined)
    router.use('/teams/:teamId', createTeamHubRouter(options.teamHubReader));
  router.use('/teams', createTeamRouter(options.teamReader));
  if (options.homepageService !== undefined)
    router.use('/homepage', createPublicHomepageRouter(options.homepageService));
  if (options.contactService !== undefined && options.contactRateLimit !== undefined) {
    router.use(
      '/contact',
      createPublicContactRouter({
        service: options.contactService,
        rateLimit: options.contactRateLimit,
      }),
    );
  }
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
