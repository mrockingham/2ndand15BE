import 'dotenv/config';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadSportsSyncConfig } from '../config/env.js';
import { createSportsDataProvider } from '../modules/sports/sports-provider-factory.js';
import { syncGames } from '../modules/sports/sync-games.js';
import { syncTeams } from '../modules/sports/sync-teams.js';

type SyncAction = 'teams' | 'games' | 'all' | 'verify';

const action = parseAction(process.argv[2]);
const dryRun = process.argv.includes('--dry-run');
const config = loadSportsSyncConfig();
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl);

try {
  if (action === 'verify') {
    await verifyLiveProvider();
  } else {
    const provider = createSportsDataProvider(config.sports, logger);
    if (action === 'teams' || action === 'all') {
      const result = await syncTeams(provider, prisma, {
        allowCreate: config.sports.provider === 'mock',
        updateDisplayFields: config.sports.provider === 'mock',
        dryRun,
      });
      logger.info({ result }, 'Sports team synchronization completed');
    }
    if (action === 'games' || action === 'all') {
      const result = await syncGames(provider, prisma, {
        query: {
          season: config.sports.apiSports.syncSeason,
          ...(config.sports.apiSports.syncSeasonType === null
            ? {}
            : { seasonType: config.sports.apiSports.syncSeasonType }),
        },
        dryRun,
      });
      logger.info({ result }, 'Sports game synchronization completed');
    }
  }
} catch (error: unknown) {
  logger.error({ err: error }, 'Sports synchronization failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

async function verifyLiveProvider(): Promise<void> {
  if (process.env.RUN_API_SPORTS_LIVE_VERIFY !== 'true') {
    logger.info(
      'Live API-Sports verification skipped; set RUN_API_SPORTS_LIVE_VERIFY=true to run it',
    );
    return;
  }

  const provider = createSportsDataProvider({ ...config.sports, provider: 'api-sports' }, logger);
  const [teams, games] = await Promise.all([
    provider.getTeams(),
    provider.getGames({
      season: config.sports.apiSports.syncSeason,
      ...(config.sports.apiSports.syncSeasonType === null
        ? {}
        : { seasonType: config.sports.apiSports.syncSeasonType }),
    }),
  ]);
  logger.info(
    {
      provider: 'api-sports',
      season: config.sports.apiSports.syncSeason,
      teamRecordsReceived: teams.received,
      teamsNormalized: teams.records.length,
      teamFailures: teams.failures.length,
      gameRecordsReceived: games.received,
      gamesNormalized: games.records.length,
      gameFailures: games.failures.length,
      databaseMutated: false,
      requestsUsed: 2,
    },
    'Live API-Sports verification completed',
  );
}

function parseAction(value: string | undefined): SyncAction {
  if (value === 'teams' || value === 'games' || value === 'all' || value === 'verify') return value;
  throw new Error('Expected sports sync action: teams, games, all, or verify.');
}
