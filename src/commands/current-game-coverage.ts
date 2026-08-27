import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadConfig } from '../config/env.js';
import { classifyCurrentGameTeamStats } from '../modules/sports/current-game-team-stat-coverage.js';

const input = z
  .object({
    season: z.coerce.number().int().min(2020).max(2100),
    seasonType: z.enum(['PRE', 'REG', 'POST']),
    week: z.coerce.number().int().min(1).max(25),
  })
  .parse(Object.fromEntries(process.argv.slice(2).map(toArgument)));
const prisma = createPrismaClient(loadConfig().databaseUrl);

try {
  const games = await prisma.game.findMany({
    where: {
      season: input.season,
      seasonType: input.seasonType,
      week: input.week,
      provenance: {
        is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
      },
    },
    orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    include: {
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
      editorialOverride: true,
      providerMaps: { select: { provider: true } },
      currentTeamStats: true,
    },
  });
  const rows = games.map((game) => {
    const status = game.editorialOverride?.status ?? game.status;
    const homeScore = game.editorialOverride?.homeScore ?? game.homeScore;
    const awayScore = game.editorialOverride?.awayScore ?? game.awayScore;
    const resultComplete = status === 'FINAL' && homeScore !== null && awayScore !== null;
    const editorialFallback =
      game.editorialOverride?.resultVerifiedAt !== null &&
      game.editorialOverride?.resultVerifiedAt !== undefined;
    const primaryProviderPresent = game.providerMaps.some(
      (mapping) => mapping.provider === 'highlightly',
    );
    const stats = classifyCurrentGameTeamStats({
      rows: game.currentTeamStats,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
    });
    return {
      gameId: game.id,
      matchup: `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`,
      kickoff: game.startTime?.toISOString() ?? null,
      status,
      homeScore,
      awayScore,
      resultCoverage: editorialFallback
        ? ('EDITORIAL_RESULT_FALLBACK' as const)
        : primaryProviderPresent
          ? ('PROVIDER_COMPLETE' as const)
          : ('PROVIDER_MISSING' as const),
      teamStatCoverage: `TEAM_STATS_${stats.classification}`,
      resultComplete,
      primaryProviderPresent,
    };
  });
  const completed = rows.filter((row) => row.resultComplete);
  const counts = await preservationCounts(prisma);
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: input,
        reviewed: rows.length,
        completed: completed.length,
        resultComplete: completed.length,
        resultCompletePercent: percent(completed.length, rows.length),
        providerComplete: rows.filter((row) => row.resultCoverage === 'PROVIDER_COMPLETE').length,
        editorialFallback: rows.filter((row) => row.resultCoverage === 'EDITORIAL_RESULT_FALLBACK')
          .length,
        providerMissing: rows.filter((row) => row.resultCoverage === 'PROVIDER_MISSING').length,
        primaryProviderMissing: rows.filter((row) => !row.primaryProviderPresent).length,
        teamStatsComplete: completed.filter((row) => row.teamStatCoverage === 'TEAM_STATS_COMPLETE')
          .length,
        teamStatsPartial: completed.filter((row) => row.teamStatCoverage === 'TEAM_STATS_PARTIAL')
          .length,
        teamStatsUnavailable: completed.filter(
          (row) => row.teamStatCoverage === 'TEAM_STATS_UNAVAILABLE',
        ).length,
        teamStatsCompletePercent: percent(
          completed.filter((row) => row.teamStatCoverage === 'TEAM_STATS_COMPLETE').length,
          completed.length,
        ),
        games: rows,
        preservation: counts,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await prisma.$disconnect();
}

function toArgument(value: string): readonly [string, string] {
  const match = /^--([^=]+)=(.+)$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('Use --season=<year> --seasonType=<PRE|REG|POST> --week=<number>.');
  }
  return [match[1], match[2]];
}

function percent(value: number, total: number): number | null {
  return total === 0 ? null : Math.round((value / total) * 10_000) / 100;
}

async function preservationCounts(prismaClient: typeof prisma) {
  const [
    games,
    games2026,
    gameProviderMappings,
    currentGameTeamStats,
    currentGamePlayerStats,
    playerGameStats,
    playerSeasonStats,
    players,
    weeklyRosters,
    resultFallbackAudits,
  ] = await Promise.all([
    prismaClient.game.count(),
    prismaClient.game.count({ where: { season: 2026 } }),
    prismaClient.gameProviderMapping.count(),
    prismaClient.currentGameTeamStat.count(),
    prismaClient.currentGamePlayerStat.count(),
    prismaClient.playerGameStat.count(),
    prismaClient.playerSeasonStat.count(),
    prismaClient.player.count(),
    prismaClient.playerWeekRoster.count(),
    prismaClient.adminAuditEvent.count({
      where: { action: { startsWith: 'GAME_RESULT_FALLBACK' } },
    }),
  ]);
  return {
    games,
    games2026,
    gameProviderMappings,
    currentGameTeamStats,
    currentGamePlayerStats,
    playerGameStats,
    playerSeasonStats,
    players,
    weeklyRosters,
    resultFallbackAudits,
  };
}
