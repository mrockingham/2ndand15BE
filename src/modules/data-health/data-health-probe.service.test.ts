/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';

import type {
  CurrentGameDetailsRepository,
  CurrentGameDetailsTarget,
} from '../sports/current-game-details.repository.js';
import { HighlightlyEvaluationHttpClient } from '../sports/evaluation/highlightly/highlightly-http-client.js';
import { highlightlyDetailedMatchSchema } from '../sports/evaluation/highlightly/highlightly-schemas.js';
import { createHighlightlyMatchDetailFetcher } from '../sports/highlightly-match-detail-fetcher.js';
import { GameDataHealthProbeService } from './data-health-probe.service.js';
import type { DataHealthRepository, ProbeGameContext } from './data-health.repository.js';

const gameId = '0768c441-16a6-457c-b50f-e7273d750d77';
const homeTeamId = '8d07dd7a-c2d5-410d-bffc-5c013f88420d';
const awayTeamId = '38c0acd1-35e3-429d-81cf-e37db8bbaf9c';
const providerGameId = '565788';

const CORE_TEAM_STATISTICS = [
  { name: 'First Downs', value: 5 },
  { name: 'Total Offensive Plays', value: 12 },
  { name: 'Total Yards', value: 40 },
  { name: 'Attempted Passes', value: 6 },
  { name: 'Team Passing Yards', value: 30 },
  { name: 'Rushing Attempts', value: 6 },
  { name: 'Rushing Yards', value: 10 },
  { name: 'Turnovers', value: 0 },
];

function rawDetail(options: { readonly teamStatsAvailable?: boolean } = {}) {
  return highlightlyDetailedMatchSchema.parse({
    id: Number(providerGameId),
    round: 'Preseason 2',
    date: '2026-08-22T23:00:00.000Z',
    league: 'NFL',
    season: 2026,
    homeTeam: {
      id: 'ne-provider',
      name: 'Patriots',
      displayName: 'New England Patriots',
      abbreviation: 'NE',
    },
    awayTeam: {
      id: 'phi-provider',
      name: 'Eagles',
      displayName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
    },
    state: {
      description: 'Finished',
      score: {
        current: '24 - 17',
        firstPeriod: '7 - 0',
        secondPeriod: null,
        thirdPeriod: null,
        fourthPeriod: null,
        firstOvertimePeriod: null,
        secondOvertimePeriod: null,
      },
    },
    matchStatistics:
      options.teamStatsAvailable === false
        ? null
        : {
            homeTeam: { statistics: CORE_TEAM_STATISTICS },
            awayTeam: { statistics: CORE_TEAM_STATISTICS },
          },
    events: [
      {
        team: {
          id: 'phi-provider',
          name: 'Eagles',
          displayName: 'Philadelphia Eagles',
          abbreviation: 'PHI',
        },
        playDetails: [
          {
            start: {
              down: 1,
              distance: 10,
              yardLine: 25,
              possessionText: 'PHI 25',
              yardsToEndzone: 75,
            },
            end: {
              down: 1,
              distance: 5,
              yardLine: 30,
              possessionText: 'PHI 30',
              yardsToEndzone: 70,
            },
            text: 'Pass complete',
            type: 'Pass Reception',
            clock: '9:45',
            period: 1,
            isPenalty: false,
          },
        ],
      },
    ],
  });
}

function rawBoxScore(playerProviderIds: readonly string[]) {
  return [
    {
      team: { id: 'ne-provider', name: 'Patriots', boxScores: [] },
    },
    {
      team: {
        id: 'phi-provider',
        name: 'Eagles',
        boxScores: playerProviderIds.map((id, index) => ({
          player: { id, fullName: `Player ${String(index)}`, name: `Player ${String(index)}` },
          statistics: [{ name: 'Total Passes', value: 1 }],
        })),
      },
    },
  ];
}

function target(overrides: Partial<CurrentGameDetailsTarget> = {}): CurrentGameDetailsTarget {
  return {
    id: gameId,
    homeTeamId,
    awayTeamId,
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    providerMapping: { providerGameId },
    teamStats: [],
    playerStats: [],
    playerCoverage: null,
    ...overrides,
  };
}

function context(overrides: Partial<ProbeGameContext> = {}): ProbeGameContext {
  return {
    status: 'FINAL',
    homeScore: 24,
    awayScore: 17,
    hasEditorialFallback: false,
    activePlayCount: 1,
    ...overrides,
  };
}

function harness(options: {
  readonly target?: CurrentGameDetailsTarget;
  readonly context?: ProbeGameContext | null;
  readonly playerMappings?: ReadonlyMap<string, string>;
  readonly detailOverrides?: Parameters<typeof rawDetail>[0];
  readonly boxScoreStatus?: number;
  readonly boxScorePlayerIds?: readonly string[];
}) {
  const detailsRepository: CurrentGameDetailsRepository = {
    findTarget: vi.fn().mockResolvedValue(options.target ?? target()),
    findPlayerMappings: vi.fn().mockResolvedValue(options.playerMappings ?? new Map()),
    applyStats: vi.fn(),
  };
  const savedProbes: unknown[] = [];
  const dataHealthRepository: DataHealthRepository = {
    listGames: vi.fn(),
    getGame: vi.fn(),
    listProbes: vi.fn(),
    saveProbe: vi.fn((input) => {
      savedProbes.push(input);
      return Promise.resolve();
    }),
    countActivePlays: vi.fn().mockResolvedValue(options.context?.activePlayCount ?? 0),
    getProbeGameContext: vi
      .fn()
      .mockResolvedValue(options.context === undefined ? context() : options.context),
  };

  const boxScorePlayerIds = options.boxScorePlayerIds ?? ['p1', 'p2'];
  const fetchImplementation = vi.fn((input: string | URL) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    if (url.pathname.includes('/matches/')) {
      return Promise.resolve(Response.json([rawDetail(options.detailOverrides)]));
    }
    if (url.pathname.includes('/box-score/')) {
      if (options.boxScoreStatus !== undefined) {
        return Promise.resolve(new Response(null, { status: options.boxScoreStatus }));
      }
      return Promise.resolve(
        Response.json(rawBoxScore(boxScorePlayerIds), {
          headers: {
            'x-ratelimit-requests-limit': '7500',
            'x-ratelimit-requests-remaining': '6812',
          },
        }),
      );
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  });

  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: 'https://example.test/',
    apiKey: 'test-key',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
    fetchImplementation,
  });
  const matchDetailFetcher = createHighlightlyMatchDetailFetcher(client);

  const service = new GameDataHealthProbeService(
    detailsRepository,
    dataHealthRepository,
    matchDetailFetcher,
    client,
    () => new Date('2026-08-24T00:00:00.000Z'),
  );

  return {
    service,
    detailsRepository,
    dataHealthRepository,
    client,
    savedProbes,
    fetchImplementation,
  };
}

describe('GameDataHealthProbeService', () => {
  it('reports MISSING_PROVIDER_MAPPING with zero requests when the game has no mapping', async () => {
    const { service, fetchImplementation } = harness({ target: target({ providerMapping: null }) });
    const result = await service.probe(gameId);
    expect(result.provider.requestCount).toBe(0);
    expect(result.playerStats.diagnosis).toBe('MISSING_PROVIDER_MAPPING');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('uses exactly two Highlightly requests and never touches production write paths', async () => {
    const { service, client, savedProbes } = harness({});
    await service.probe(gameId);
    expect(client.getRequestCount()).toBe(2);
    expect(savedProbes).toHaveLength(1);
  });

  it('reports PROVIDER_HAS_PLAYER_STATS_DB_MISSING when the provider has stats resolved via existing mappings but the database has none', async () => {
    const { service, dataHealthRepository } = harness({
      playerMappings: new Map([
        ['p1', 'internal-player-1'],
        ['p2', 'internal-player-2'],
      ]),
    });
    const result = await service.probe(gameId);
    expect(result.playerStats.resolvedPlayers).toBe(2);
    expect(result.playerStats.unresolvedPlayers).toBe(0);
    expect(result.playerStats.databaseRows).toBe(0);
    expect(result.playerStats.diagnosis).toBe('PROVIDER_HAS_PLAYER_STATS_DB_MISSING');
    expect(vi.mocked(dataHealthRepository.saveProbe)).toHaveBeenCalledWith(
      expect.objectContaining({ playerStatsDiagnosis: 'PROVIDER_HAS_PLAYER_STATS_DB_MISSING' }),
    );
  });

  it('reports PLAYER_IDENTITY_UNRESOLVED when some players have no existing mapping', async () => {
    const { service } = harness({
      playerMappings: new Map([['p1', 'internal-player-1']]),
    });
    const result = await service.probe(gameId);
    expect(result.playerStats.resolvedPlayers).toBe(1);
    expect(result.playerStats.unresolvedPlayers).toBe(1);
    expect(result.playerStats.diagnosis).toBe('PLAYER_IDENTITY_UNRESOLVED');
  });

  it('reports DB_PLAYER_STATS_PARTIAL when the database has fewer rows than resolved players', async () => {
    const { service } = harness({
      playerMappings: new Map([
        ['p1', 'internal-player-1'],
        ['p2', 'internal-player-2'],
      ]),
      target: target({
        playerStats: [{ id: 'row-1' }] as never,
      }),
    });
    const result = await service.probe(gameId);
    expect(result.playerStats.diagnosis).toBe('DB_PLAYER_STATS_PARTIAL');
  });

  it('reports PROVIDER_NO_PLAYER_STATS when the box score is empty', async () => {
    const { service } = harness({ boxScorePlayerIds: [] });
    const result = await service.probe(gameId);
    expect(result.playerStats.providerAvailable).toBe(false);
    expect(result.playerStats.diagnosis).toBe('PROVIDER_NO_PLAYER_STATS');
  });

  it('reports PROVIDER_NO_TEAM_STATS when the provider has no team statistics', async () => {
    const { service } = harness({ detailOverrides: { teamStatsAvailable: false } });
    const result = await service.probe(gameId);
    expect(result.teamStats.diagnosis).toBe('PROVIDER_NO_TEAM_STATS');
  });

  it('reports PROVIDER_HAS_TEAM_STATS_DB_MISSING when the provider has stats and the database has none', async () => {
    const { service } = harness({});
    const result = await service.probe(gameId);
    expect(result.teamStats.databaseRows).toBe(0);
    expect(result.teamStats.diagnosis).toBe('PROVIDER_HAS_TEAM_STATS_DB_MISSING');
  });

  it('reports a sanitized PROVIDER_REQUEST_FAILED when the match-detail request fails and never persists a raw payload', async () => {
    const fetchImplementation = vi.fn().mockRejectedValue(new TypeError('network down'));
    const client = new HighlightlyEvaluationHttpClient({
      baseUrl: 'https://example.test/',
      apiKey: 'test-key',
      requestTimeoutMs: 1_000,
      maxRetries: 0,
      fetchImplementation,
    });
    const detailsRepository: CurrentGameDetailsRepository = {
      findTarget: vi.fn().mockResolvedValue(target()),
      findPlayerMappings: vi.fn().mockResolvedValue(new Map()),
      applyStats: vi.fn(),
    };
    const dataHealthRepository: DataHealthRepository = {
      listGames: vi.fn(),
      getGame: vi.fn(),
      listProbes: vi.fn(),
      saveProbe: vi.fn().mockResolvedValue(undefined),
      countActivePlays: vi.fn().mockResolvedValue(0),
      getProbeGameContext: vi.fn().mockResolvedValue(context()),
    };
    const service = new GameDataHealthProbeService(
      detailsRepository,
      dataHealthRepository,
      createHighlightlyMatchDetailFetcher(client),
      client,
    );
    const result = await service.probe(gameId);
    expect(result.provider.reachable).toBe(false);
    expect(result.playerStats.diagnosis).toBe('PROVIDER_REQUEST_FAILED');
    expect(result.teamStats.diagnosis).toBe('PROVIDER_REQUEST_FAILED');
    const saveProbeMock = vi.mocked(dataHealthRepository.saveProbe);
    expect(saveProbeMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerReachable: false }),
    );
    const saved: unknown = saveProbeMock.mock.calls[0]?.[0];
    expect(JSON.stringify(saved)).not.toContain('network down');
  });

  it('captures quota headers from the box-score response', async () => {
    const { service } = harness({});
    const result = await service.probe(gameId);
    expect(result.provider.quotaLimit).toBe(7500);
    expect(result.provider.quotaRemaining).toBe(6812);
  });
});
