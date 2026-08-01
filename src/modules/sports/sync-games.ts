import type { Game, PrismaClient } from '../../generated/prisma/client.js';
import type { NormalizedGame } from './normalized-game.js';
import type { SportsDataProvider } from './sports-data-provider.js';

export interface GameSyncFailure {
  readonly providerGameId: string;
  readonly reason: string;
}

export interface GameSyncResult {
  readonly provider: string;
  readonly providerRecordsReceived: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly GameSyncFailure[];
  readonly dryRun: boolean;
}

export interface GameSyncOptions {
  readonly query?: Parameters<SportsDataProvider['getGames']>[0];
  readonly dryRun?: boolean;
}

export async function syncGames(
  provider: SportsDataProvider,
  prisma: PrismaClient,
  options: GameSyncOptions = {},
): Promise<GameSyncResult> {
  const batch = await provider.getGames(options.query ?? {});
  const games = batch.records;
  const providerNames = new Set(games.map((game) => game.provider));
  if (providerNames.size > 1 || (providerNames.size === 1 && !providerNames.has(batch.provider))) {
    throw new Error('A game sync batch must contain exactly one provider.');
  }

  const providerName = batch.provider;
  const teamProviderIds = [
    ...new Set(games.flatMap((game) => [game.homeProviderTeamId, game.awayProviderTeamId])),
  ];
  const teamMappings = await prisma.teamProviderMapping.findMany({
    where: { provider: providerName, providerTeamId: { in: teamProviderIds } },
    select: { providerTeamId: true, teamId: true },
  });
  const teamIdsByProviderId = new Map(
    teamMappings.map((mapping) => [mapping.providerTeamId, mapping.teamId]),
  );

  const existingMappings = await prisma.gameProviderMapping.findMany({
    where: {
      provider: providerName,
      providerGameId: { in: games.map((game) => game.providerGameId) },
    },
    include: { game: true },
  });
  const existingByProviderGameId = new Map(
    existingMappings.map((mapping) => [mapping.providerGameId, mapping.game]),
  );

  const failures: GameSyncFailure[] = batch.failures.map((failure) => ({
    providerGameId: failure.providerRecordId ?? 'unknown',
    reason: failure.reason,
  }));
  const ready: {
    normalized: NormalizedGame;
    homeTeamId: string;
    awayTeamId: string;
    existing: Game | undefined;
  }[] = [];

  for (const game of games) {
    const homeTeamId = teamIdsByProviderId.get(game.homeProviderTeamId);
    const awayTeamId = teamIdsByProviderId.get(game.awayProviderTeamId);
    if (homeTeamId === undefined || awayTeamId === undefined) {
      const missing = [
        ...(homeTeamId === undefined ? [game.homeProviderTeamId] : []),
        ...(awayTeamId === undefined ? [game.awayProviderTeamId] : []),
      ];
      failures.push({
        providerGameId: game.providerGameId,
        reason: `Missing ${providerName} team mapping: ${missing.join(', ')}`,
      });
      continue;
    }
    ready.push({
      normalized: game,
      homeTeamId,
      awayTeamId,
      existing: existingByProviderGameId.get(game.providerGameId),
    });
  }

  let created = 0;
  let updated = 0;
  let skipped = Math.max(0, batch.received - games.length - batch.failures.length);

  for (const item of ready) {
    const data = toGameWrite(item.normalized, item.homeTeamId, item.awayTeamId);
    if (item.existing === undefined) {
      if (options.dryRun) {
        created += 1;
        continue;
      }
      await prisma.$transaction(async (transaction) => {
        const game = await transaction.game.create({ data });
        await transaction.gameProviderMapping.create({
          data: {
            gameId: game.id,
            provider: item.normalized.provider,
            providerGameId: item.normalized.providerGameId,
          },
        });
      });
      created += 1;
    } else if (matchesPersistedGame(item.existing, data)) {
      skipped += 1;
    } else if (options.dryRun) {
      updated += 1;
    } else {
      const existingId = item.existing.id;
      await prisma.$transaction(async (transaction) => {
        await transaction.game.update({ where: { id: existingId }, data });
      });
      updated += 1;
    }
  }

  return {
    provider: providerName,
    providerRecordsReceived: batch.received,
    created,
    updated,
    skipped,
    failed: failures.length,
    failures,
    dryRun: options.dryRun ?? false,
  };
}

function toGameWrite(game: NormalizedGame, homeTeamId: string, awayTeamId: string) {
  return {
    league: game.league,
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    startTime: new Date(game.startTime),
    status: game.status,
    homeTeamId,
    awayTeamId,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    quarter: game.quarter,
    clock: game.clock,
    venueName: game.venueName,
    venueCity: game.venueCity,
    broadcastNetwork: game.broadcastNetwork,
    isNeutralSite: game.isNeutralSite,
    providerLastUpdatedAt:
      game.providerLastUpdatedAt === null ? null : new Date(game.providerLastUpdatedAt),
  };
}

function matchesPersistedGame(game: Game, expected: ReturnType<typeof toGameWrite>): boolean {
  return (
    game.season === expected.season &&
    game.seasonType === expected.seasonType &&
    game.week === expected.week &&
    game.startTime.getTime() === expected.startTime.getTime() &&
    game.status === expected.status &&
    game.homeTeamId === expected.homeTeamId &&
    game.awayTeamId === expected.awayTeamId &&
    game.homeScore === expected.homeScore &&
    game.awayScore === expected.awayScore &&
    game.quarter === expected.quarter &&
    game.clock === expected.clock &&
    game.venueName === expected.venueName &&
    game.venueCity === expected.venueCity &&
    game.broadcastNetwork === expected.broadcastNetwork &&
    game.isNeutralSite === expected.isNeutralSite &&
    game.providerLastUpdatedAt?.getTime() === expected.providerLastUpdatedAt?.getTime()
  );
}
