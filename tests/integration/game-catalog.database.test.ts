import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import type { NormalizedGame } from '../../src/modules/sports/normalized-game.js';
import { MockSportsDataProvider } from '../../src/modules/sports/providers/mock/mock-sports-data-provider.js';
import { mockNflGamesFixture } from '../../src/modules/sports/providers/mock/nfl-games.fixture.js';
import type { SportsDataProvider } from '../../src/modules/sports/sports-data-provider.js';
import { syncGames } from '../../src/modules/sports/sync-games.js';
import { syncTeams } from '../../src/modules/sports/sync-teams.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('game catalog database', () => {
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
    const provider = new MockSportsDataProvider();
    await syncTeams(provider, prisma);
    await syncGames(provider, prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('persists fixture games and unique provider mappings idempotently', async () => {
    const client = requirePrisma(prisma);
    expect(await client.gameProviderMapping.count({ where: { provider: 'mock' } })).toBe(
      mockNflGamesFixture.length,
    );
    const before = await client.gameProviderMapping.findMany({
      where: { provider: 'mock' },
      select: { providerGameId: true, gameId: true },
    });
    const result = await syncGames(new MockSportsDataProvider(), client);
    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      skipped: mockNflGamesFixture.length,
      failed: 0,
    });
    const after = await client.gameProviderMapping.findMany({
      where: { provider: 'mock' },
      select: { providerGameId: true, gameId: true },
    });
    expect(after.sort(byProviderId)).toEqual(before.sort(byProviderId));
    const firstMapping = requireValue(before.at(0), 'Expected a seeded game mapping.');
    await expect(
      client.gameProviderMapping.create({
        data: {
          gameId: firstMapping.gameId,
          provider: 'mock',
          providerGameId: firstMapping.providerGameId,
        },
      }),
    ).rejects.toBeDefined();
  });

  it('enforces model constraints for teams, scores, week, and quarter', async () => {
    const client = requirePrisma(prisma);
    const teams = await client.team.findMany({ take: 2, orderBy: { id: 'asc' } });
    const homeTeam = requireValue(teams.at(0), 'Expected a home team.');
    const awayTeam = requireValue(teams.at(1), 'Expected an away team.');
    const base = {
      league: 'NFL' as const,
      season: 2026,
      seasonType: 'REG' as const,
      startTime: new Date('2030-01-01T00:00:00.000Z'),
      status: 'SCHEDULED' as const,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
    };
    await expect(
      client.game.create({ data: { ...base, awayTeamId: homeTeam.id } }),
    ).rejects.toBeDefined();
    await expect(
      client.game.create({ data: { ...base, homeScore: -1, awayScore: 0 } }),
    ).rejects.toBeDefined();
    await expect(
      client.game.create({ data: { ...base, homeScore: 1, awayScore: null } }),
    ).rejects.toBeDefined();
    await expect(client.game.create({ data: { ...base, week: 23 } })).rejects.toBeDefined();
    await expect(client.game.create({ data: { ...base, quarter: 11 } })).rejects.toBeDefined();
  });

  it('queries by season, type, week, UTC range, team, status, and limit', async () => {
    const client = requirePrisma(prisma);
    const repository = new PrismaGameRepository(client, 'mock');
    const buffalo = await client.teamProviderMapping.findUniqueOrThrow({
      where: { provider_providerTeamId: { provider: 'mock', providerTeamId: 'nfl-buf' } },
      select: { teamId: true },
    });
    expect((await repository.findGames({ season: 2026, limit: 100 })).games).toHaveLength(9);
    expect((await repository.findGames({ seasonType: 'PRE', limit: 100 })).games).toHaveLength(3);
    expect(
      (await repository.findGames({ week: 1, limit: 100 })).games.length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      (
        await repository.findGames({
          startTime: new Date('2026-09-01T00:00:00.000Z'),
          endTime: new Date('2026-09-30T23:59:59.999Z'),
          limit: 100,
        })
      ).games,
    ).toHaveLength(4);
    expect((await repository.findGames({ teamId: buffalo.teamId, limit: 100 })).games).toHaveLength(
      2,
    );
    const finals = (await repository.findGames({ status: 'FINAL', limit: 100 })).games;
    expect(finals).toHaveLength(1);
    expect(finals.at(0)).toMatchObject({ homeScore: 27, awayScore: 20 });
    const page = await repository.findGames({ season: 2026, limit: 1 });
    expect(page.games).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('returns the bounded default window and public DTOs without provider mappings', async () => {
    const service = new GameService(
      new PrismaGameRepository(requirePrisma(prisma), 'mock'),
      () => new Date('2026-07-31T12:00:00.000Z'),
    );
    const result = await service.listGames({ limit: 20 });
    expect(result.games).toHaveLength(3);
    expect(result.games[0]).not.toHaveProperty('providerMaps');
    expect(result.games[0]?.homeTeam).not.toHaveProperty('providerMaps');
    expect(result.games.find((game) => game.status === 'SCHEDULED')).toMatchObject({
      homeScore: null,
      awayScore: null,
    });
  });

  it('updates mutable fields while preserving the internal game ID and can restore the fixture', async () => {
    const client = requirePrisma(prisma);
    const original = firstFixtureGame();
    const mapping = await client.gameProviderMapping.findUniqueOrThrow({
      where: {
        provider_providerGameId: {
          provider: original.provider,
          providerGameId: original.providerGameId,
        },
      },
    });
    const changed: NormalizedGame = {
      ...original,
      status: 'IN_PROGRESS',
      homeScore: 7,
      awayScore: 3,
      quarter: 1,
      clock: '04:12',
      providerLastUpdatedAt: '2026-08-02T23:45:00.000Z',
    };
    const changedResult = await syncGames(singleGameProvider(changed), client);
    expect(changedResult.updated).toBe(1);
    expect(
      await client.game.findUniqueOrThrow({
        where: { id: mapping.gameId },
        select: { status: true, homeScore: true },
      }),
    ).toEqual({ status: 'IN_PROGRESS', homeScore: 7 });
    const restored = await syncGames(singleGameProvider(original), client);
    expect(restored.updated).toBe(1);
    const sameMapping = await client.gameProviderMapping.findUniqueOrThrow({
      where: {
        provider_providerGameId: {
          provider: original.provider,
          providerGameId: original.providerGameId,
        },
      },
    });
    expect(sameMapping.gameId).toBe(mapping.gameId);
  });

  it('reports a game whose provider-team mappings cannot be resolved', async () => {
    const game: NormalizedGame = {
      ...firstFixtureGame(),
      provider: 'unmapped-development',
      providerGameId: 'unmapped-game',
    };
    await expect(syncGames(singleGameProvider(game), requirePrisma(prisma))).resolves.toMatchObject(
      {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      },
    );
  });
});

function singleGameProvider(game: NormalizedGame): SportsDataProvider {
  return {
    getTeams: () =>
      Promise.resolve({ provider: game.provider, received: 0, records: [], failures: [] }),
    getGames: () =>
      Promise.resolve({ provider: game.provider, received: 1, records: [game], failures: [] }),
    getGameByProviderId: () => Promise.resolve(game),
  };
}
function byProviderId(left: { providerGameId: string }, right: { providerGameId: string }): number {
  return left.providerGameId.localeCompare(right.providerGameId);
}
function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined)
    throw new Error('Database integration test client was not initialized.');
  return prisma;
}

function firstFixtureGame(): NormalizedGame {
  return requireValue(mockNflGamesFixture.at(0), 'The development game fixture must not be empty.');
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
