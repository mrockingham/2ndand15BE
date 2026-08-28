import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { HighlightlyEvaluationHttpClient } from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { createHighlightlyBoxScoreFetcher } from '../modules/sports/highlightly-box-score-fetcher.js';
import { createHighlightlyMatchDetailFetcher } from '../modules/sports/highlightly-match-detail-fetcher.js';
import {
  HIGHLIGHTLY_PLAYER_STATISTIC_NAMES,
  normalizeHighlightlyCurrentGamePlayerStats,
} from '../modules/sports/providers/highlightly/highlightly-current-game-details-provider.js';
import type { NormalizedCurrentGamePlayerStats } from '../modules/sports/current-game-details-provider.js';
import { PrismaGameStatsRepository } from '../modules/game-stats/game-stats.repository.js';
import {
  toCurrentGameLeadersDto,
  toCurrentGamePlayerStatsDto,
  type CurrentGamePlayerStatsByCategory,
} from '../modules/game-stats/game-stats.dto.js';

const CATEGORY_FIELDS = {
  passing: [
    'passingCompletions',
    'passingAttempts',
    'passingYards',
    'passingTouchdowns',
    'passingInterceptions',
    'sacksSuffered',
  ],
  rushing: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'longestRush'],
  receiving: ['targets', 'receptions', 'receivingYards', 'receivingTouchdowns', 'longestReception'],
  defense: [
    'tacklesTotal',
    'tacklesSolo',
    'defensiveSacks',
    'tacklesForLoss',
    'passesDefended',
    'defensiveTouchdowns',
  ],
  kicking: [
    'fieldGoalsMade',
    'fieldGoalsAttempted',
    'longestFieldGoal',
    'extraPointsMade',
    'extraPointsAttempted',
  ],
  punting: ['punts', 'puntYards', 'puntAverage', 'puntsInside20', 'puntTouchbacks', 'longestPunt'],
  returns: [
    'kickReturns',
    'kickReturnYards',
    'kickReturnTouchdowns',
    'longestKickReturn',
    'puntReturns',
    'puntReturnYards',
    'puntReturnTouchdowns',
    'longestPuntReturn',
  ],
} as const satisfies Readonly<Record<string, readonly (keyof NormalizedCurrentGamePlayerStats)[]>>;

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const args = parseArgs(process.argv.slice(2));
  const config = loadCurrentGameSyncConfig();
  const logger = createLogger(config);
  prisma = createPrismaClient(config.databaseUrl);
  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.currentGame.highlightly.baseUrl,
    apiKey: config.currentGame.highlightly.apiKey,
    requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
    maxRetries: config.currentGame.highlightly.maxRetries,
    logger,
  });
  const matchFetcher = createHighlightlyMatchDetailFetcher(client);
  const boxScoreFetcher = createHighlightlyBoxScoreFetcher(client);
  const publicStatsRepository = new PrismaGameStatsRepository(prisma);
  const now = new Date();
  const since = new Date(now.getTime() - args.hours * 60 * 60_000);
  const games = await prisma.game.findMany({
    where: {
      league: 'NFL',
      season: 2026,
      startTime: { gte: since, lte: now },
      providerMaps: { some: { provider: 'highlightly' } },
    },
    orderBy: { startTime: 'desc' },
    take: args.limit,
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      startTime: true,
      status: true,
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
      providerMaps: {
        where: { provider: 'highlightly' },
        take: 1,
        select: { providerGameId: true },
      },
    },
  });

  const reports = [];
  for (const game of games) {
    const providerGameId = game.providerMaps[0]?.providerGameId;
    if (providerGameId === undefined) continue;
    const requestsBefore = client.getRequestCount();
    const [detailResult, boxResult] = await Promise.all([
      matchFetcher.fetch(providerGameId),
      boxScoreFetcher.fetch(providerGameId),
    ]);
    let normalizedRows: readonly NormalizedCurrentGamePlayerStats[] = [];
    let normalizationError: string | null = null;
    if (detailResult.detail !== null && boxResult.boxScore !== null) {
      try {
        normalizedRows = normalizeHighlightlyCurrentGamePlayerStats(
          detailResult.detail,
          boxResult.boxScore,
          providerGameId,
        );
      } catch (error: unknown) {
        normalizationError = error instanceof Error ? error.message : 'Normalization failed.';
      }
    }
    const mappings = await prisma.playerExternalIdentifier.findMany({
      where: {
        provider: 'highlightly',
        externalId: { in: normalizedRows.map((row) => row.providerPlayerId) },
      },
      select: { externalId: true },
    });
    const rawRows = boxResult.boxScore?.flatMap((entry) => entry.team.boxScores) ?? [];
    const storedBoxScore = await publicStatsRepository.findPlayerBoxScore(game.id);
    const publicPlayerStats = toCurrentGamePlayerStatsDto(
      storedBoxScore.rows,
      game.homeTeamId,
      game.awayTeamId,
    );
    const publicLeaders = toCurrentGameLeadersDto(publicPlayerStats);
    const unexpectedStatisticNames = [
      ...new Set(
        rawRows.flatMap((row) =>
          row.statistics.flatMap((statistic) => {
            const name = statistic.name ?? statistic.displayName;
            return name === undefined || HIGHLIGHTLY_PLAYER_STATISTIC_NAMES.has(name) ? [] : [name];
          }),
        ),
      ),
    ].sort();
    reports.push({
      internalGameId: game.id,
      matchup: `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
      startTime: game.startTime?.toISOString() ?? null,
      storedStatus: game.status,
      mappingVerified: true,
      matchDetailLoaded: detailResult.detail !== null,
      boxScoreLoaded: boxResult.boxScore !== null,
      teams: boxResult.boxScore?.length ?? 0,
      rawPlayerRows: rawRows.length,
      normalizedPlayerRows: normalizedRows.length,
      playerProviderIdsAvailable: rawRows.filter((row) => row.player.id !== undefined).length,
      playerNamesAvailable: rawRows.filter(
        (row) => row.player.fullName !== undefined || row.player.name !== undefined,
      ).length,
      teamIdsAvailable: boxResult.boxScore?.length ?? 0,
      existingIdentityMappings: mappings.length,
      unresolvedPlayerRows: normalizedRows.length - mappings.length,
      storedPlayerRows: storedBoxScore.rows.length,
      storedCoverage: storedBoxScore.coverage,
      publicCategoryRows: {
        home: categoryCounts(publicPlayerStats.home),
        away: categoryCounts(publicPlayerStats.away),
      },
      publicLeadersAvailable: {
        home: {
          passer: publicLeaders.home.passer !== null,
          rusher: publicLeaders.home.rusher !== null,
          receiver: publicLeaders.home.receiver !== null,
        },
        away: {
          passer: publicLeaders.away.passer !== null,
          rusher: publicLeaders.away.rusher !== null,
          receiver: publicLeaders.away.receiver !== null,
        },
      },
      categories: Object.fromEntries(
        Object.entries(CATEGORY_FIELDS).map(([category, fields]) => [
          category,
          {
            playerRows: normalizedRows.filter((row) => fields.some((field) => row[field] !== null))
              .length,
            fields: Object.fromEntries(
              fields.map((field) => [
                field,
                normalizedRows.filter((row) => row[field] !== null).length,
              ]),
            ),
          },
        ]),
      ),
      normalizationError,
      unexpectedStatisticNames,
      detailFailure: detailResult.failureReason,
      boxScoreFailure: boxResult.failureReason,
      requests: client.getRequestCount() - requestsBefore,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: now.toISOString(),
        windowHours: args.hours,
        gamesFound: games.length,
        totalRequests: client.getRequestCount(),
        games: reports,
      },
      null,
      2,
    )}\n`,
  );
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      error: { message: error instanceof Error ? error.message : 'Box-score audit failed.' },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseArgs(argv: readonly string[]): { readonly hours: number; readonly limit: number } {
  const value = (name: string): string | undefined =>
    argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const hours = z.coerce.number().int().min(1).max(168).default(24).parse(value('hours'));
  const limit = z.coerce.number().int().min(1).max(16).default(2).parse(value('limit'));
  return { hours, limit };
}

function categoryCounts(stats: CurrentGamePlayerStatsByCategory): Record<string, number> {
  return {
    passing: stats.passing.length,
    rushing: stats.rushing.length,
    receiving: stats.receiving.length,
    defense: stats.defense.length,
    kicking: stats.kicking.length,
    punting: stats.punting.length,
    returns: stats.returns.length,
  };
}
