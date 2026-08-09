import 'dotenv/config';

import { createApp } from './app.js';
import { createPrismaClient } from './common/database/prisma.js';
import { createLogger } from './common/logging/logger.js';
import { JwtAccessTokenService } from './common/security/access-token.js';
import { CryptoOpaqueTokenService } from './common/security/opaque-token.js';
import { Argon2idPasswordHasher } from './common/security/password-hasher.js';
import { loadConfig } from './config/env.js';
import { PrismaAuthRepository } from './modules/auth/auth.repository.js';
import { PrismaAdminRepository } from './modules/admin/admin.repository.js';
import { AdminService } from './modules/admin/admin.service.js';
import { PrismaArticleRepository } from './modules/articles/article.repository.js';
import { ArticleService } from './modules/articles/article.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { DevelopmentEmailService } from './modules/email/in-memory-email.service.js';
import {
  PrismaGameRepository,
  resolvePublicGameDataSource,
} from './modules/games/game.repository.js';
import { GameService } from './modules/games/game.service.js';
import { PrismaGameStatsRepository } from './modules/game-stats/game-stats.repository.js';
import { GameStatsService } from './modules/game-stats/game-stats.service.js';
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

const config = loadConfig();
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl);
const adminRepository = new PrismaAdminRepository(prisma);
const adminService = new AdminService(adminRepository);
const articleService = new ArticleService(new PrismaArticleRepository(prisma));
const newsInboxService = new NewsInboxService(
  new PrismaNewsInboxRepository(prisma),
  new SafeFeedClient(),
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
const editorialAiService = new EditorialAiService(
  new PrismaEditorialAiRepository(prisma),
  editorialAiProvider,
);
const teamReader = new TeamService(new PrismaTeamRepository(prisma));
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
const gameStatsReader = new GameStatsService(new PrismaGameStatsRepository(prisma), gameReader);
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
const emailService = new DevelopmentEmailService(logger, config.email.logResetUrl);
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
const app = createApp({
  config,
  logger,
  teamReader,
  gameReader,
  gameStatsReader,
  authService,
  userService,
  accessTokens,
  adminService,
  adminIdentities: adminRepository,
  articleReader: articleService,
  editorialArticleService: articleService,
  newsInboxService,
  editorialAiService,
  playerReader,
  statsHubReader,
  teamHubReader,
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
