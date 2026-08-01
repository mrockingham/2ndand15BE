import { describe, expect, it, vi } from 'vitest';

import type { SportsConfig } from '../../../../config/env.js';
import {
  ApiSportsDataProvider,
  mapApiSportsStatus,
  normalizeApiSportsGame,
} from './api-sports-data-provider.js';
import type { ApiSportsHttpClient } from './api-sports-http-client.js';
import type { ApiSportsGame } from './api-sports-schemas.js';

const config: SportsConfig['apiSports'] = {
  baseUrl: 'https://v1.american-football.api-sports.io',
  apiKey: 'test-key',
  requestTimeoutMs: 1_000,
  maxRetries: 0,
  syncSeason: 2024,
  syncSeasonType: null,
  storeLogoUrls: false,
};

describe('ApiSportsDataProvider', () => {
  it('validates and normalizes an NFL team while keeping provider logo storage disabled', async () => {
    const { paging: _paging, ...teamEnvelope } = envelope([
      {
        id: 20,
        name: 'Buffalo Bills',
        code: 'BUF',
        city: 'Buffalo',
        logo: 'https://media.api-sports.io/american-football/teams/20.png',
        country: { name: 'USA', code: 'US', flag: null },
      },
    ]);
    void _paging;
    const provider = createProvider(teamEnvelope);

    await expect(provider.getTeams()).resolves.toEqual({
      provider: 'api-sports',
      received: 1,
      failures: [],
      records: [
        expect.objectContaining({
          provider: 'api-sports',
          providerTeamId: '20',
          abbreviation: 'BUF',
          fullName: 'Buffalo Bills',
          logoUrl: null,
          logoSource: null,
        }),
      ],
    });
  });

  it('normalizes timestamps to UTC, completed scores, season type, week, and venue', async () => {
    const game = apiGame();
    const provider = createProvider(envelope([game]));
    const batch = await provider.getGames({ season: 2024 });

    expect(batch.failures).toEqual([]);
    expect(batch.records[0]).toMatchObject({
      providerGameId: '101',
      season: 2024,
      seasonType: 'REG',
      week: 1,
      startTime: '2024-09-06T00:20:00.000Z',
      status: 'FINAL',
      homeScore: 31,
      awayScore: 24,
      venueName: 'Highmark Stadium',
      broadcastNetwork: null,
      providerLastUpdatedAt: null,
    });
  });

  it('preserves unavailable scores as a null pair', () => {
    const normalized = normalizeApiSportsGame(
      apiGame({
        status: { short: 'NS', long: 'Not Started', timer: null },
        home: null,
        away: null,
      }),
    );
    expect(normalized).toMatchObject({ status: 'SCHEDULED', homeScore: null, awayScore: null });
  });

  it.each([
    ['NS', 'SCHEDULED'],
    ['TBD', 'SCHEDULED'],
    ['PREG', 'PREGAME'],
    ['Q1', 'IN_PROGRESS'],
    ['Q2', 'IN_PROGRESS'],
    ['HT', 'HALFTIME'],
    ['Q3', 'IN_PROGRESS'],
    ['Q4', 'IN_PROGRESS'],
    ['OT', 'IN_PROGRESS'],
    ['BT', 'IN_PROGRESS'],
    ['P', 'IN_PROGRESS'],
    ['FT', 'FINAL'],
    ['AOT', 'FINAL'],
    ['POST', 'POSTPONED'],
    ['CANC', 'CANCELED'],
    ['SUSP', 'SUSPENDED'],
    ['INT', 'SUSPENDED'],
  ] as const)('maps API-Sports status %s to %s', (providerStatus, normalizedStatus) => {
    expect(mapApiSportsStatus(providerStatus)).toBe(normalizedStatus);
  });

  it('skips an unknown status with a record failure instead of guessing', async () => {
    const provider = createProvider(
      envelope([apiGame({ status: { short: 'MYSTERY', long: 'Unknown', timer: null } })]),
    );
    const batch = await provider.getGames({});
    expect(batch.records).toEqual([]);
    expect(batch.failures).toHaveLength(1);
    expect(batch.failures[0]?.providerRecordId).toBe('101');
    expect(batch.failures[0]?.reason).toContain('MYSTERY');
  });

  it('reports malformed records without leaking the raw provider payload', async () => {
    const malformed = { game: { id: 999 } };
    const provider = createProvider(envelope([malformed]));
    const batch = await provider.getGames({});
    expect(batch.records).toEqual([]);
    expect(batch.failures[0]?.providerRecordId).toBe('999');
    expect(batch.failures[0]?.reason).toContain('failed validation');
    expect(JSON.stringify(batch.failures)).not.toContain(JSON.stringify(malformed));
  });

  it('rejects an invalid response envelope and a provider error envelope', async () => {
    const invalidProvider = createProvider({ results: 1, response: [] });
    await expect(invalidProvider.getGames({})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const errorProvider = createProvider(envelope([], { plan: 'not available' }));
    await expect(errorProvider.getGames({})).rejects.toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      message: 'API-Sports quota or plan access was exhausted.',
    });
  });
});

function createProvider(payload: unknown): ApiSportsDataProvider {
  const client = { get: vi.fn().mockResolvedValue(payload) } as unknown as ApiSportsHttpClient;
  return new ApiSportsDataProvider({ config, client });
}

function envelope(response: readonly unknown[], errors: Readonly<Record<string, unknown>> = {}) {
  return {
    get: 'games',
    parameters: { league: '1', season: '2024' },
    errors,
    results: response.length,
    paging: { current: 1, total: 1 },
    response,
  };
}

function apiGame(
  overrides: {
    readonly status?: ApiSportsGame['game']['status'];
    readonly home?: number | null;
    readonly away?: number | null;
  } = {},
): ApiSportsGame {
  return {
    game: {
      id: 101,
      stage: 'Regular Season',
      week: 'Week 1',
      date: {
        timezone: 'UTC',
        date: '2024-09-06',
        time: '00:20',
        timestamp: 1_725_582_000,
      },
      venue: { name: 'Highmark Stadium', city: 'Orchard Park' },
      status: overrides.status ?? { short: 'FT', long: 'Finished', timer: null },
    },
    league: {
      id: 1,
      name: 'NFL',
      season: '2024',
      logo: null,
      country: { name: 'USA', code: 'US', flag: null },
    },
    teams: {
      home: { id: 20, name: 'Buffalo Bills', logo: null },
      away: { id: 25, name: 'Miami Dolphins', logo: null },
    },
    scores: {
      home: {
        quarter_1: null,
        quarter_2: null,
        quarter_3: null,
        quarter_4: null,
        overtime: null,
        total: overrides.home === undefined ? 31 : overrides.home,
      },
      away: {
        quarter_1: null,
        quarter_2: null,
        quarter_3: null,
        quarter_4: null,
        overtime: null,
        total: overrides.away === undefined ? 24 : overrides.away,
      },
    },
  };
}
