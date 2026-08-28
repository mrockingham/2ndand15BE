import 'dotenv/config';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import type { SeasonType } from '../generated/prisma/client.js';
import { PrismaStandingsRepository } from '../modules/standings/standings.repository.js';
import { HighlightlyEvaluationHttpClient } from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyStandingsProvider } from '../modules/sports/providers/highlightly/highlightly-standings-provider.js';

const config = loadCurrentGameSyncConfig();
const logger = createLogger(config);
const prisma = createPrismaClient(config.databaseUrl);

try {
  const season = parseSeason(argumentValue('--season='));
  const seasonType = parseSeasonType(argumentValue('--seasonType='));
  const write = process.argv.includes('--write');
  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.currentGame.highlightly.baseUrl,
    apiKey: config.currentGame.highlightly.apiKey,
    requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
    maxRetries: config.currentGame.highlightly.maxRetries,
    logger,
  });
  const provider = new HighlightlyStandingsProvider(client);
  const records = await provider.getStandings({ season, seasonType });
  const repository = new PrismaStandingsRepository(prisma);
  const result = write
    ? await repository.replaceProviderSnapshot({
        provider: provider.providerKey,
        season,
        seasonType,
        updatedAt: new Date(),
        records,
      })
    : null;
  logger.info(
    {
      provider: provider.providerKey,
      season,
      seasonType,
      records: records.length,
      requestsUsed: client.getRequestCount(),
      databaseMutated: write,
      result,
    },
    write ? 'Standings synchronization completed' : 'Standings dry run completed',
  );
} catch (error: unknown) {
  logger.error({ err: error }, 'Standings synchronization failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function argumentValue(prefix: string): string | undefined {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function parseSeason(value: string | undefined): number {
  const season = Number(value);
  if (!Number.isInteger(season) || season < 1920 || season > 2100) {
    throw new Error('Expected --season=YYYY.');
  }
  return season;
}
function parseSeasonType(value: string | undefined): SeasonType {
  if (value === 'PRE' || value === 'REG') return value;
  if (value === 'POST') throw new Error('Postseason standings are not supplied by Highlightly.');
  throw new Error('Expected --seasonType=PRE or --seasonType=REG.');
}
