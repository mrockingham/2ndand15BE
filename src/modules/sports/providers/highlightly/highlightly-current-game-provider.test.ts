import { describe, expect, it, vi } from 'vitest';

import { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import type { HighlightlyMatch } from '../../evaluation/highlightly/highlightly-schemas.js';
import {
  HighlightlyCurrentGameProvider,
  mapHighlightlyStatus,
  normalizeHighlightlyCurrentGame,
} from './highlightly-current-game-provider.js';

const hallOfFameGame: HighlightlyMatch = {
  id: 565788,
  round: 'Preseason',
  date: '2026-08-07T00:00:00.000Z',
  league: 'NFL',
  season: 2026,
  homeTeam: {
    id: 7,
    name: 'Arizona Cardinals',
    displayName: 'Arizona Cardinals',
    abbreviation: 'ARI',
  },
  awayTeam: {
    id: 29,
    name: 'Carolina Panthers',
    displayName: 'Carolina Panthers',
    abbreviation: 'CAR',
  },
  state: { description: 'Finished', period: 4, clock: 0, score: { current: '30 - 33' } },
};

describe('HighlightlyCurrentGameProvider', () => {
  it('normalizes the verified final with provider home score first', () => {
    expect(normalizeHighlightlyCurrentGame(hallOfFameGame)).toMatchObject({
      provider: 'highlightly',
      providerGameId: '565788',
      seasonType: 'PRE',
      week: null,
      status: 'FINAL',
      homeAbbreviation: 'ARI',
      awayAbbreviation: 'CAR',
      homeScore: 30,
      awayScore: 33,
      quarter: 4,
      clock: '0',
    });
  });

  it.each([
    ['Not Started', 'SCHEDULED'],
    ['Pregame', 'PREGAME'],
    ['In Progress', 'IN_PROGRESS'],
    ['Halftime', 'HALFTIME'],
    ['Finished', 'FINAL'],
    ['Postponed', 'POSTPONED'],
    ['Cancelled', 'CANCELED'],
    ['Interrupted', 'SUSPENDED'],
    ['Unknown', null],
  ] as const)('maps %s to %s', (input, expected) => {
    expect(mapHighlightlyStatus(input)).toBe(expected);
  });

  it('rejects scheduled scores and final games without both scores', () => {
    expect(
      normalizeHighlightlyCurrentGame({
        ...hallOfFameGame,
        state: { description: 'Scheduled', score: { current: '0 - 0' } },
      }),
    ).toBeNull();
    expect(
      normalizeHighlightlyCurrentGame({
        ...hallOfFameGame,
        state: { description: 'Finished', score: { current: null } },
      }),
    ).toBeNull();
  });

  it('preserves factual zero scores for an in-progress game', () => {
    expect(
      normalizeHighlightlyCurrentGame({
        ...hallOfFameGame,
        state: { description: 'In Progress', period: 1, score: { current: '0 - 0' } },
      }),
    ).toMatchObject({ status: 'IN_PROGRESS', homeScore: 0, awayScore: 0 });
  });

  it('uses one bounded request and ignores invalid records outside the target window', async () => {
    const outside = { ...hallOfFameGame, date: '2026-09-01T00:00:00.000Z', state: {} };
    const fetchImplementation = vi.fn().mockResolvedValue(
      Response.json({
        data: [outside, hallOfFameGame],
        pagination: { totalCount: 2, offset: 0, limit: 100 },
      }),
    );
    const client = new HighlightlyEvaluationHttpClient({
      baseUrl: 'https://example.test',
      apiKey: 'private-test-key',
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      fetchImplementation,
    });

    await expect(
      new HighlightlyCurrentGameProvider(client).getCurrentGames({
        season: 2026,
        startTime: new Date('2026-08-06T12:00:00.000Z'),
        endTime: new Date('2026-08-07T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ records: [{ providerGameId: '565788' }], failures: [] });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
