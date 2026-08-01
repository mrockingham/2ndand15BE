import { describe, expect, it, vi } from 'vitest';

import type { Game, PrismaClient } from '../../generated/prisma/client.js';
import { createGameRecord } from '../games/game.test-fixtures.js';
import type { NormalizedGame } from './normalized-game.js';
import { mockNflGamesFixture } from './providers/mock/nfl-games.fixture.js';
import type { SportsDataProvider } from './sports-data-provider.js';
import { syncGames } from './sync-games.js';

const normalized: NormalizedGame = firstFixtureGame();

function createProvider(games: readonly NormalizedGame[] = [normalized]): SportsDataProvider {
  return {
    getTeams: () => Promise.resolve({ provider: 'mock', received: 0, records: [], failures: [] }),
    getGames: () =>
      Promise.resolve({ provider: 'mock', received: games.length, records: games, failures: [] }),
    getGameByProviderId: () => Promise.resolve(games.at(0) ?? null),
  };
}

function persistedGame(overrides: Partial<Game> = {}): Game {
  const {
    homeTeam: _homeTeam,
    awayTeam: _awayTeam,
    ...game
  } = createGameRecord({
    seasonType: normalized.seasonType,
    week: normalized.week,
    startTime: new Date(normalized.startTime),
    status: normalized.status,
    homeTeamId: 'home-team-id',
    awayTeamId: 'away-team-id',
    homeScore: normalized.homeScore,
    awayScore: normalized.awayScore,
    quarter: normalized.quarter,
    clock: normalized.clock,
    venueName: normalized.venueName,
    venueCity: normalized.venueCity,
    broadcastNetwork: normalized.broadcastNetwork,
    isNeutralSite: normalized.isNeutralSite,
    providerLastUpdatedAt:
      normalized.providerLastUpdatedAt === null ? null : new Date(normalized.providerLastUpdatedAt),
    ...overrides,
  });
  void _homeTeam;
  void _awayTeam;
  return game;
}

function createPrisma(existing?: Game, includeAwayMapping = true) {
  const createGame = vi.fn().mockResolvedValue({ id: 'new-game-id' });
  const updateGame = vi.fn().mockResolvedValue({});
  const createMapping = vi.fn().mockResolvedValue({});
  const transaction = {
    game: { create: createGame, update: updateGame },
    gameProviderMapping: { create: createMapping },
  };
  const runTransaction = vi.fn((callback: (value: typeof transaction) => Promise<void>) =>
    callback(transaction),
  );
  const prisma = {
    teamProviderMapping: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { providerTeamId: normalized.homeProviderTeamId, teamId: 'home-team-id' },
          ...(includeAwayMapping
            ? [{ providerTeamId: normalized.awayProviderTeamId, teamId: 'away-team-id' }]
            : []),
        ]),
    },
    gameProviderMapping: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          existing === undefined
            ? []
            : [{ providerGameId: normalized.providerGameId, game: existing }],
        ),
    },
    $transaction: runTransaction,
  } as unknown as PrismaClient;
  return { prisma, createGame, updateGame, createMapping, runTransaction };
}

describe('syncGames', () => {
  it('creates a game and provider mapping on the first synchronization', async () => {
    const harness = createPrisma();
    await expect(syncGames(createProvider(), harness.prisma)).resolves.toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(harness.createGame).toHaveBeenCalledOnce();
    expect(harness.createMapping).toHaveBeenCalledOnce();
  });

  it('preserves the internal ID and skips an unchanged repeated synchronization', async () => {
    const existing = persistedGame();
    const harness = createPrisma(existing);
    await expect(syncGames(createProvider(), harness.prisma)).resolves.toMatchObject({
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(harness.createGame).not.toHaveBeenCalled();
    expect(harness.updateGame).not.toHaveBeenCalled();
  });

  it('updates mutable game state through the existing internal game ID', async () => {
    const existing = persistedGame({ status: 'PREGAME' });
    const harness = createPrisma(existing);
    await expect(syncGames(createProvider(), harness.prisma)).resolves.toMatchObject({
      updated: 1,
    });
    expect(harness.updateGame).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: existing.id } }),
    );
    expect(harness.createMapping).not.toHaveBeenCalled();
  });

  it('reports a missing provider-team mapping without writing a partial game', async () => {
    const harness = createPrisma(undefined, false);
    const result = await syncGames(createProvider(), harness.prisma);
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 0, failed: 1 });
    expect(result.failures[0]).toMatchObject({ providerGameId: normalized.providerGameId });
    expect(harness.createGame).not.toHaveBeenCalled();
  });

  it('uses a small atomic transaction for each game in a large synchronization batch', async () => {
    const second = { ...normalized, providerGameId: 'second-provider-game' };
    const harness = createPrisma();
    await expect(
      syncGames(createProvider([normalized, second]), harness.prisma),
    ).resolves.toMatchObject({ created: 2 });
    expect(harness.runTransaction).toHaveBeenCalledTimes(2);
  });
});

function firstFixtureGame(): NormalizedGame {
  const game = mockNflGamesFixture.at(0);
  if (game === undefined) throw new Error('The development game fixture must not be empty.');
  return game;
}
