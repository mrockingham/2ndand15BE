import 'dotenv/config';

import { createPrismaClient } from '../src/common/database/prisma.js';
import { createLogger } from '../src/common/logging/logger.js';
import { loadDatabaseConfig } from '../src/config/env.js';
import { MockSportsDataProvider } from '../src/modules/sports/providers/mock/mock-sports-data-provider.js';
import { syncGames } from '../src/modules/sports/sync-games.js';
import { syncTeams } from '../src/modules/sports/sync-teams.js';

const config = loadDatabaseConfig();
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl);

try {
  const provider = new MockSportsDataProvider();
  const teamResult = await syncTeams(provider, prisma);
  logger.info(teamResult, 'Team seed completed');
  const gameResult = await syncGames(provider, prisma);
  logger.info(gameResult, 'Development game fixture seed completed');
} catch (error: unknown) {
  logger.error({ err: error }, 'Team seed failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
