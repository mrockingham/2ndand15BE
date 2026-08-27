import 'dotenv/config';

import { createApp } from './app.js';
import { createPrismaClient } from './common/database/prisma.js';
import { createLogger } from './common/logging/logger.js';
import { JwtAccessTokenService } from './common/security/access-token.js';
import { CryptoOpaqueTokenService } from './common/security/opaque-token.js';
import { Argon2idPasswordHasher } from './common/security/password-hasher.js';
import { loadConfig, loadCurrentGameSyncConfig } from './config/env.js';
import { PrismaAuthRepository } from './modules/auth/auth.repository.js';
import { PrismaAdminRepository } from './modules/admin/admin.repository.js';
import { AdminService } from './modules/admin/admin.service.js';
import { PrismaCurrentGamePlayRepository } from './modules/sports/current-game-play.repository.js';
import { PrismaCurrentGamePollStateRepository } from './modules/sports/current-game-poll-state.repository.js';
import { ReconciliationDiagnosticService } from './modules/sports/current-game-play-reconciliation-diagnostic.js';
import { PlayReconciliationRepairService } from './modules/sports/current-game-play-repair.js';
import { HighlightlyEvaluationHttpClient } from './modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyCurrentGamePlayProvider } from './modules/sports/providers/highlightly/highlightly-current-game-play-provider.js';
import { PrismaCurrentGameDetailsRepository } from './modules/sports/current-game-details.repository.js';
import { createHighlightlyMatchDetailFetcher } from './modules/sports/highlightly-match-detail-fetcher.js';
import { PrismaDataHealthRepository } from './modules/data-health/data-health.repository.js';
import { DataHealthService } from './modules/data-health/data-health.service.js';
import { GameDataHealthProbeService } from './modules/data-health/data-health-probe.service.js';
import { createHighlightlyHighlightFetcher } from './modules/sports/highlightly-highlight-fetcher.js';
import { createHighlightlyGeoRestrictionFetcher } from './modules/sports/highlightly-geo-restriction-fetcher.js';
import { PrismaGameHighlightsRepository } from './modules/game-highlights/game-highlights.repository.js';
import {
  GameHighlightsService,
  type GameHighlightSyncDependencies,
} from './modules/game-highlights/game-highlights.service.js';
import { PrismaGameMediaCurationRepository } from './modules/game-media-curation/game-media-curation.repository.js';
import { GameMediaCurationService } from './modules/game-media-curation/game-media-curation.service.js';
import { PrismaHomepageRepository } from './modules/homepage/homepage.repository.js';
import { PrismaContactRepository } from './modules/contact/contact.repository.js';
import { ContactService } from './modules/contact/contact.service.js';
import { HomepageService } from './modules/homepage/homepage.service.js';
import { PrismaGlobalGameMediaRepository } from './modules/game-media-curation/global-game-media.repository.js';
import { PrismaArticleRepository } from './modules/articles/article.repository.js';
import { ArticleService } from './modules/articles/article.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { DevelopmentEmailService } from './modules/email/in-memory-email.service.js';
import { ResendEmailService } from './modules/email/resend-email.service.js';
import type { EmailService } from './modules/email/email.service.js';
import {
  PrismaGameRepository,
  resolvePublicGameDataSource,
} from './modules/games/game.repository.js';
import { GameService } from './modules/games/game.service.js';
import { PrismaGameStatsRepository } from './modules/game-stats/game-stats.repository.js';
import { GameStatsService } from './modules/game-stats/game-stats.service.js';
import { PrismaGamePlayRepository } from './modules/game-plays/game-plays.repository.js';
import { GamePlayService } from './modules/game-plays/game-plays.service.js';
import { PrismaTeamRepository } from './modules/teams/team.repository.js';
import { TeamService } from './modules/teams/team.service.js';
import { PrismaUserRepository } from './modules/users/user.repository.js';
import { UserService } from './modules/users/user.service.js';
import { SafeFeedClient } from './modules/news-inbox/feed-client.js';
import { PrismaNewsInboxRepository } from './modules/news-inbox/news.repository.js';
import { NewsInboxService } from './modules/news-inbox/news.service.js';
import { PrismaPlayerRepository } from './modules/players/player.repository.js';
import { PlayerService } from './modules/players/player.service.js';
import { PrismaStatsHubRepository } from './modules/stats-hub/stats.repository.js';
import { StatsHubService } from './modules/stats-hub/stats.service.js';
import { PrismaTeamHubRepository } from './modules/team-hub/team-hub.repository.js';
import { TeamHubService } from './modules/team-hub/team-hub.service.js';
import { PrismaEditorialAiRepository } from './modules/editorial-ai/editorial-ai.repository.js';
import { EditorialAiService } from './modules/editorial-ai/editorial-ai.service.js';
import {
  OpenAiEditorialAiProvider,
  UnconfiguredEditorialAiProvider,
} from './modules/editorial-ai/editorial-ai.provider.js';
import { PrismaCandidateQualityRepository } from './modules/editorial-ai/candidate-quality.repository.js';
import { CandidateQualityService } from './modules/editorial-ai/candidate-quality.service.js';
import { OpenAiCandidateClassifier } from './modules/editorial-ai/candidate-quality.provider.js';
import { PrismaLaunchDiscoveryRepository } from './modules/editorial-ai/launch-discovery.repository.js';
import { LaunchDiscoveryService } from './modules/editorial-ai/launch-discovery.service.js';
import { PrismaPredictionRepository } from './modules/ai-hub/prediction.repository.js';
import { PredictionService } from './modules/ai-hub/prediction.service.js';
import { AiHubWeeklyInsightsService } from './modules/ai-hub/weekly-insights.service.js';
import {
  OpenAiPredictionExplainer,
  UnconfiguredPredictionExplainer,
} from './modules/ai-hub/prediction-explainer.js';

const config = loadConfig();
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl);
const adminRepository = new PrismaAdminRepository(prisma);
// The plays-reconciliation review/repair admin endpoints require Highlightly current-game
// configuration, which is loaded separately (see loadCurrentGameSyncConfig) and is not otherwise
// required to run this server. Missing/invalid config here must never prevent the HTTP server
// from starting — those endpoints simply report themselves as unconfigured (500
// GAME_PLAYS_REVIEW_UNCONFIGURED) until the relevant env vars are set.
let playsDiagnosticService: ReconciliationDiagnosticService | undefined;
let playsRepairService: PlayReconciliationRepairService | undefined;
// The Data Health provider probe (M29A) requires the same Highlightly current-game
// configuration as the plays-reconciliation review/repair endpoints above, so it is built
// inside the same try block and reuses the same HighlightlyEvaluationHttpClient instance --
// a second client would silently split rate-limit/request-count observation across two
// untracked counters. Missing/invalid config must never prevent the HTTP server from
// starting: the DB-only Data Health overview/detail endpoints always work regardless, and
// only the probe endpoint reports itself unconfigured (500 GAME_DATA_HEALTH_PROBE_UNCONFIGURED).
const dataHealthRepository = new PrismaDataHealthRepository(prisma);
let dataHealthProbeService: GameDataHealthProbeService | undefined;
// M31: the game-highlights sync (POST .../highlights/sync) requires the same
// Highlightly configuration and reuses the same client instance as the Data Health
// probe above, for the same request-count/rate-limit-tracking reason. The DB-only
// read endpoints (GET .../highlights, GET .../highlights/diagnostic) never depend
// on this and always work even when this block fails.
let gameHighlightSyncDependencies: GameHighlightSyncDependencies | undefined;
// M31C: defaults to disabled -- see the kill-switch note on
// `HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED` in config/env.ts. Read independently of
// `gameHighlightSyncDependencies` so public reads keep refusing to report
// `canEmbed` even if the try block below fails entirely.
let gameHighlightEmbedPlaybackEnabled = false;
try {
  const currentGameConfig = loadCurrentGameSyncConfig();
  gameHighlightEmbedPlaybackEnabled = currentGameConfig.currentGame.embedPlaybackEnabled;
  const highlightlyClient = new HighlightlyEvaluationHttpClient({
    baseUrl: currentGameConfig.currentGame.highlightly.baseUrl,
    apiKey: currentGameConfig.currentGame.highlightly.apiKey,
    requestTimeoutMs: currentGameConfig.currentGame.highlightly.requestTimeoutMs,
    maxRetries: currentGameConfig.currentGame.highlightly.maxRetries,
    logger,
  });
  const currentGamePlayProvider = new HighlightlyCurrentGamePlayProvider(highlightlyClient);
  const currentGamePlayRepository = new PrismaCurrentGamePlayRepository(prisma);
  const currentGamePollStateRepository = new PrismaCurrentGamePollStateRepository(prisma);
  playsDiagnosticService = new ReconciliationDiagnosticService(
    currentGamePlayProvider,
    currentGamePlayRepository,
  );
  playsRepairService = new PlayReconciliationRepairService(
    currentGamePlayProvider,
    currentGamePlayRepository,
    currentGamePollStateRepository,
  );
  dataHealthProbeService = new GameDataHealthProbeService(
    new PrismaCurrentGameDetailsRepository(prisma),
    dataHealthRepository,
    createHighlightlyMatchDetailFetcher(highlightlyClient),
    highlightlyClient,
  );
  gameHighlightSyncDependencies = {
    fetcher: createHighlightlyHighlightFetcher(highlightlyClient),
    client: highlightlyClient,
    geoFetcher: createHighlightlyGeoRestrictionFetcher(highlightlyClient),
    embedAllowedHosts: currentGameConfig.currentGame.embedAllowedHosts,
  };
} catch (error: unknown) {
  logger.warn(
    { err: error },
    'Current-game configuration is unavailable; plays reconciliation review/repair, data-health probe, and game-highlight sync admin endpoints will report unconfigured.',
  );
}
const adminService = new AdminService(
  adminRepository,
  () => new Date(),
  playsDiagnosticService,
  playsRepairService,
);
const dataHealthService = new DataHealthService(dataHealthRepository, dataHealthProbeService);
const gameHighlightsService = new GameHighlightsService(
  new PrismaGameHighlightsRepository(prisma),
  gameHighlightSyncDependencies,
  () => new Date(),
  gameHighlightEmbedPlaybackEnabled,
);
const gameMediaCurationService = new GameMediaCurationService(
  new PrismaGameMediaCurationRepository(prisma),
  gameHighlightsService,
  config.gameMediaCuration.embedAllowedHosts,
  new PrismaGlobalGameMediaRepository(prisma),
);
const articleService = new ArticleService(new PrismaArticleRepository(prisma));
const newsInboxService = new NewsInboxService(
  new PrismaNewsInboxRepository(prisma),
  new SafeFeedClient(),
  config.newsIngestion,
);
const editorialAiProvider =
  config.editorialAi.provider === 'openai' &&
  config.editorialAi.apiKey !== null &&
  config.editorialAi.model !== null
    ? new OpenAiEditorialAiProvider({
        apiKey: config.editorialAi.apiKey,
        model: config.editorialAi.model,
        baseUrl: config.editorialAi.baseUrl,
        timeoutMs: config.editorialAi.timeoutMs,
      })
    : new UnconfiguredEditorialAiProvider();
const candidateClassifier =
  config.editorialAi.provider === 'openai' &&
  config.editorialAi.apiKey !== null &&
  config.editorialAi.model !== null
    ? new OpenAiCandidateClassifier({
        apiKey: config.editorialAi.apiKey,
        model: config.editorialAi.model,
        baseUrl: config.editorialAi.baseUrl,
        timeoutMs: config.editorialAi.timeoutMs,
      })
    : null;
const candidateQualityService = new CandidateQualityService(
  new PrismaCandidateQualityRepository(prisma),
  candidateClassifier,
);
const launchDiscoveryService = new LaunchDiscoveryService(
  new PrismaLaunchDiscoveryRepository(prisma),
  newsInboxService,
  candidateQualityService,
);
const editorialAiService = new EditorialAiService(
  new PrismaEditorialAiRepository(prisma),
  editorialAiProvider,
  undefined,
  candidateQualityService,
  launchDiscoveryService,
);
const teamReader = new TeamService(new PrismaTeamRepository(prisma));
const predictionExplainer =
  config.editorialAi.provider === 'openai' &&
  config.editorialAi.apiKey !== null &&
  config.editorialAi.model !== null
    ? new OpenAiPredictionExplainer({
        apiKey: config.editorialAi.apiKey,
        model: config.editorialAi.model,
        baseUrl: config.editorialAi.baseUrl,
        timeoutMs: config.editorialAi.timeoutMs,
      })
    : new UnconfiguredPredictionExplainer();
const predictionRepository = new PrismaPredictionRepository(prisma);
const predictionService = new PredictionService(
  predictionRepository,
  undefined,
  predictionExplainer,
);
const weeklyInsightsService = new AiHubWeeklyInsightsService(predictionRepository);
const playerReader = new PlayerService(new PrismaPlayerRepository(prisma));
const statsHubReader = new StatsHubService(new PrismaStatsHubRepository(prisma));
const publicGameSource = resolvePublicGameDataSource(config.sports);
const gameReader = new GameService(
  new PrismaGameRepository(prisma, publicGameSource),
  () => new Date(),
  {
    currentNflSeason: config.sports.currentNflSeason,
    allowHistoricalDefaultGameResults: config.sports.allowHistoricalDefaultGameResults,
  },
);
const gameStatsReader = new GameStatsService(
  new PrismaGameStatsRepository(prisma, publicGameSource),
  gameReader,
  config.sports.currentNflSeason,
);
const gamePlayReader = new GamePlayService(new PrismaGamePlayRepository(prisma), gameReader);
const homepageService = new HomepageService({
  repository: new PrismaHomepageRepository(prisma),
  gameMedia: gameMediaCurationService,
  stats: statsHubReader,
  aiHub: weeklyInsightsService,
  fallbackSeason: config.sports.currentNflSeason,
});
const teamHubReader = new TeamHubService({
  repository: new PrismaTeamHubRepository(prisma),
  teams: teamReader,
  games: gameReader,
  articles: articleService,
  stats: statsHubReader,
  currentNflSeason: config.sports.currentNflSeason,
});
const accessTokens = new JwtAccessTokenService({
  secret: config.auth.accessTokenSecret,
  expiresInSeconds: config.auth.accessTokenTtlSeconds,
});
const emailService: EmailService =
  config.email.provider === 'resend'
    ? new ResendEmailService({
        apiKey: config.email.resendApiKey ?? '',
        from: config.email.from,
        contactToEmail: config.contact.toEmail,
        logger,
      })
    : new DevelopmentEmailService(logger, config.email.logResetUrl);
const authService = new AuthService({
  repository: new PrismaAuthRepository(prisma),
  passwordHasher: new Argon2idPasswordHasher(),
  accessTokens,
  opaqueTokens: new CryptoOpaqueTokenService(),
  emailService,
  refreshTokenTtlSeconds: config.auth.refreshTokenTtlSeconds,
  passwordResetTokenTtlSeconds: config.passwordReset.tokenTtlSeconds,
  passwordResetFrontendUrl: config.passwordReset.frontendUrl,
  onEmailDeliveryError: (error) => {
    logger.error({ err: error }, 'Password reset email delivery failed');
  },
});
const userService = new UserService(new PrismaUserRepository(prisma));
const contactService = new ContactService({
  repository: new PrismaContactRepository(prisma),
  emailService,
  onNotificationDeliveryError: (error) => {
    logger.error({ err: error }, 'Contact notification email delivery failed');
  },
});
const app = createApp({
  config,
  logger,
  teamReader,
  gameReader,
  gameStatsReader,
  gamePlayReader,
  authService,
  userService,
  accessTokens,
  adminService,
  adminIdentities: adminRepository,
  dataHealthService,
  gameHighlightsService,
  gameMediaCurationService,
  homepageService,
  articleReader: articleService,
  editorialArticleService: articleService,
  newsInboxService,
  editorialAiService,
  playerReader,
  statsHubReader,
  teamHubReader,
  predictionService,
  weeklyInsightsService,
  contactService,
  readiness: {
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
  },
});

const server = app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'Failed to start HTTP server');
    process.exitCode = 1;
    return;
  }

  logger.info({ host: config.host, port: config.port }, 'HTTP server started');
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, 'Shutting down HTTP server');
  server.close((error) => {
    void prisma.$disconnect();
    if (error) {
      logger.error({ err: error }, 'HTTP server shutdown failed');
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
