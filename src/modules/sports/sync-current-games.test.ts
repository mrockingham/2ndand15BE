import { describe, expect, it, vi } from 'vitest';

import type { CurrentGameProvider } from './current-game-provider.js';
import type {
  ApplyCurrentGameInput,
  CurrentGameRecord,
  CurrentGameSyncRepository,
} from './current-game-sync.repository.js';
import type { NormalizedGame } from './normalized-game.js';
import { CurrentGameSyncService, matchCurrentGame } from './sync-current-games.js';

const internalGame: CurrentGameRecord = {
  id: '0768c441-16a6-457c-b50f-e7273d750d77',
  season: 2026,
  seasonType: 'PRE',
  week: null,
  startTime: new Date('2026-08-07T00:00:00.000Z'),
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  quarter: null,
  clock: null,
  venueName: 'Tom Benson Hall of Fame Stadium',
  venueCity: 'Canton, OH',
  broadcastNetwork: 'NBC',
  homeTeam: { abbreviation: 'ARI', providerTeamId: null },
  awayTeam: { abbreviation: 'CAR', providerTeamId: null },
  providerMapping: null,
};

const providerGame: NormalizedGame = {
  provider: 'highlightly',
  providerGameId: '565788',
  league: 'NFL',
  season: 2026,
  seasonType: 'PRE',
  week: null,
  startTime: '2026-08-07T00:00:00.000Z',
  status: 'FINAL',
  homeProviderTeamId: '7',
  awayProviderTeamId: '29',
  homeAbbreviation: 'ARI',
  awayAbbreviation: 'CAR',
  homeScore: 30,
  awayScore: 33,
  quarter: 4,
  clock: '0',
  venueName: null,
  venueCity: null,
  broadcastNetwork: null,
  isNeutralSite: false,
  providerLastUpdatedAt: null,
};

const evaluationPolicy = {
  nodeEnv: 'development' as const,
  evaluationMode: true,
  publicationApproved: false,
};

function harness(game: CurrentGameRecord = internalGame) {
  let stored = game;
  const applyCurrentGame = vi.fn((input: ApplyCurrentGameInput) => {
    stored = {
      ...stored,
      ...input.state,
      providerMapping: input.createMapping
        ? { providerGameId: input.providerGameId }
        : stored.providerMapping,
    };
    return Promise.resolve();
  });
  const findMappedGameId = vi.fn(() => Promise.resolve<string | null>(null));
  const repository: CurrentGameSyncRepository = {
    findGame: vi.fn(() => Promise.resolve(stored)),
    findMappedGameId,
    applyCurrentGame,
  };
  const getCurrentGames = vi.fn<CurrentGameProvider['getCurrentGames']>(() =>
    Promise.resolve({
      provider: 'highlightly',
      received: 1,
      records: [providerGame],
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 20,
    }),
  );
  const provider: CurrentGameProvider = {
    providerKey: 'highlightly',
    getCurrentGames,
  };
  return {
    service: new CurrentGameSyncService(provider, repository),
    getCurrentGames,
    findMappedGameId,
    applyCurrentGame,
  };
}

describe('CurrentGameSyncService', () => {
  it('dry-runs the exact state and mapping changes without writing', async () => {
    const test = harness();
    const report = await test.service.sync({
      gameId: internalGame.id,
      apply: false,
      policy: evaluationPolicy,
    });
    expect(report).toMatchObject({
      dryRun: true,
      matched: 1,
      results: [
        {
          internalGameId: internalGame.id,
          providerGameId: '565788',
          outcome: 'WOULD_UPDATE',
          matchMethod: 'SCHEDULE',
          mappingChange: 'CREATE',
        },
      ],
    });
    expect(report.results[0]?.changes).toContainEqual({
      field: 'status',
      from: 'SCHEDULED',
      to: 'FINAL',
    });
    expect(report.results[0]?.changes).toContainEqual({ field: 'homeScore', from: null, to: 30 });
    expect(report.results[0]?.changes).toContainEqual({ field: 'awayScore', from: null, to: 33 });
    expect(report.results[0]?.providerSnapshot).toMatchObject({
      startTime: '2026-08-07T00:00:00.000Z',
      homeAbbreviation: 'ARI',
      awayAbbreviation: 'CAR',
      status: 'FINAL',
      homeScore: 30,
      awayScore: 33,
    });
    expect(test.applyCurrentGame).not.toHaveBeenCalled();
  });

  it('applies once and is unchanged when repeated', async () => {
    const test = harness();
    await expect(
      test.service.sync({ gameId: internalGame.id, apply: true, policy: evaluationPolicy }),
    ).resolves.toMatchObject({ updated: 1, results: [{ mappingChange: 'CREATE' }] });
    await expect(
      test.service.sync({ gameId: internalGame.id, apply: true, policy: evaluationPolicy }),
    ).resolves.toMatchObject({ unchanged: 1, results: [{ outcome: 'UNCHANGED' }] });
    expect(test.applyCurrentGame).toHaveBeenCalledOnce();
  });

  it('rejects reversed home and away orientation', () => {
    const result = matchCurrentGame(internalGame, [
      {
        ...providerGame,
        homeAbbreviation: 'CAR',
        awayAbbreviation: 'ARI',
        homeScore: 33,
        awayScore: 30,
      },
    ]);
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.reason : '').toContain('orientation');
  });

  it.each([
    [{ ...providerGame, season: 2025 }, 'unmatched'],
    [{ ...providerGame, seasonType: 'REG' as const }, 'unmatched'],
    [{ ...providerGame, homeAbbreviation: 'BUF' }, 'unmatched'],
  ])('does not match an incompatible schedule identity', (candidate, expectedKind) => {
    expect(matchCurrentGame(internalGame, [candidate]).kind).toBe(expectedKind);
  });

  it('matches a neutral-site game by reviewed orientation rather than venue', () => {
    expect(
      matchCurrentGame(internalGame, [{ ...providerGame, isNeutralSite: true }]),
    ).toMatchObject({ kind: 'matched', method: 'SCHEDULE' });
  });

  it('reuses an existing mapping before schedule fallback', () => {
    const result = matchCurrentGame(
      { ...internalGame, providerMapping: { providerGameId: '565788' } },
      [providerGame],
    );
    expect(result).toMatchObject({ kind: 'matched', method: 'PROVIDER_MAPPING' });
  });

  it('reports ambiguous matches without mutating', async () => {
    const test = harness();
    test.getCurrentGames.mockResolvedValueOnce({
      provider: 'highlightly',
      received: 2,
      records: [providerGame, { ...providerGame, providerGameId: 'duplicate' }],
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 20,
    });
    await expect(
      test.service.sync({ gameId: internalGame.id, apply: true, policy: evaluationPolicy }),
    ).resolves.toMatchObject({ ambiguous: 1 });
    expect(test.applyCurrentGame).not.toHaveBeenCalled();
  });

  it('rejects a provider identity already mapped to another game', async () => {
    const test = harness();
    test.findMappedGameId.mockResolvedValueOnce('other-game');
    const report = await test.service.sync({
      gameId: internalGame.id,
      apply: true,
      policy: evaluationPolicy,
    });
    expect(report.failed).toBe(1);
    expect(report.results[0]?.reason).toContain('different');
    expect(test.applyCurrentGame).not.toHaveBeenCalled();
  });

  it('blocks Highlightly production writes without publication approval before fetching', async () => {
    const test = harness();
    await expect(
      test.service.sync({
        gameId: internalGame.id,
        apply: true,
        policy: { nodeEnv: 'production', evaluationMode: true, publicationApproved: false },
      }),
    ).rejects.toMatchObject({ code: 'HIGHLIGHTLY_PUBLICATION_NOT_APPROVED' });
    expect(test.getCurrentGames).not.toHaveBeenCalled();
  });
});
