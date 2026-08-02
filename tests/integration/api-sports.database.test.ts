import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';

const runDatabaseTests = process.env.RUN_API_SPORTS_DATABASE_TESTS === 'true';
const describeDatabase = runDatabaseTests ? describe : describe.skip;

describeDatabase('API-Sports hosted synchronization verification', () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = createPrismaClient(loadDatabaseConfig().databaseUrl);
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('keeps one 32-team NFL catalog with one API-Sports mapping per team', async () => {
    const [teams, mappings] = await Promise.all([
      client.team.findMany({ where: { league: 'NFL' }, select: { id: true, abbreviation: true } }),
      client.teamProviderMapping.findMany({
        where: { provider: 'api-sports' },
        select: { teamId: true, providerTeamId: true },
      }),
    ]);

    expect(teams).toHaveLength(32);
    expect(new Set(teams.map((team) => team.abbreviation)).size).toBe(32);
    expect(mappings).toHaveLength(32);
    expect(new Set(mappings.map((mapping) => mapping.teamId)).size).toBe(32);
    expect(new Set(mappings.map((mapping) => mapping.providerTeamId)).size).toBe(32);
  });

  it('stores normalized real games without mixing mock mappings', async () => {
    const [realMappings, mixedGames] = await Promise.all([
      client.gameProviderMapping.count({ where: { provider: 'api-sports' } }),
      client.game.count({
        where: {
          AND: [
            { providerMaps: { some: { provider: 'api-sports' } } },
            { providerMaps: { some: { provider: 'mock' } } },
          ],
        },
      }),
    ]);
    expect(realMappings).toBeGreaterThan(0);
    expect(mixedGames).toBe(0);
  });

  it('returns source-isolated public DTOs without provider metadata', async () => {
    const apiSportsService = new GameService(
      new PrismaGameRepository(client, 'api-sports'),
      () => new Date('2026-08-01T12:00:00.000Z'),
      { currentNflSeason: 2026, allowHistoricalDefaultGameResults: false },
    );
    const mockService = new GameService(new PrismaGameRepository(client, 'mock'));
    const realPage = await apiSportsService.listGames({
      season: 2024,
      seasonType: 'REG',
      limit: 5,
    });
    const mockPage = await mockService.listGames({ season: 2024, seasonType: 'REG', limit: 5 });

    expect(realPage.games.length).toBeGreaterThan(0);
    expect(mockPage.games).toEqual([]);
    const publicGame = realPage.games[0];
    expect(publicGame).not.toHaveProperty('providerMaps');
    expect(publicGame).not.toHaveProperty('providerGameId');
    expect(publicGame?.homeTeam).not.toHaveProperty('providerMaps');
    expect(publicGame?.homeTeam).not.toHaveProperty('providerTeamId');
  });

  it('returns no historical data by default while preserving explicit historical queries', async () => {
    const service = new GameService(
      new PrismaGameRepository(client, 'api-sports'),
      () => new Date('2026-08-01T12:00:00.000Z'),
      { currentNflSeason: 2026, allowHistoricalDefaultGameResults: false },
    );
    await expect(service.listGames({ limit: 5 })).resolves.toEqual({
      games: [],
      nextCursor: null,
    });
    const historical = await service.listGames({ season: 2024, seasonType: 'REG', limit: 5 });
    expect(historical.games.length).toBeGreaterThan(0);
    expect(historical.games.every((game) => game.season === 2024)).toBe(true);
  });

  it('excludes fixture data when disabled and exposes it only through the mock source', async () => {
    const disabled = new GameService(new PrismaGameRepository(client, 'none'));
    const enabled = new GameService(new PrismaGameRepository(client, 'mock'));
    await expect(disabled.listGames({ season: 2026, limit: 5 })).resolves.toEqual({
      games: [],
      nextCursor: null,
    });
    const fixturePage = await enabled.listGames({ season: 2026, limit: 5 });
    expect(fixturePage.games.length).toBeGreaterThan(0);
  });
});
