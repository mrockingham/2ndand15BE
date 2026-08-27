import { describe, expect, it, vi } from 'vitest';

import type { GamePlay } from '../../generated/prisma/client.js';
import type { CurrentGameProvider } from './current-game-provider.js';
import type {
  CurrentGamePlayProvider,
  CurrentGamePlayBatch,
} from './current-game-play-provider.js';
import type {
  CurrentGamePlayApplyInput,
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import type {
  CurrentGameRecord,
  CurrentGameSyncRepository,
} from './current-game-sync.repository.js';
import type {
  CurrentGameDetailsRepository,
  CurrentGameDetailsTarget,
} from './current-game-details.repository.js';
import type {
  CurrentGameDetailsProvider,
  NormalizedCurrentGameDetails,
} from './current-game-details-provider.js';
import type { HighlightlyDetailedMatch } from './evaluation/highlightly/highlightly-schemas.js';
import { highlightlyDetailedMatchSchema } from './evaluation/highlightly/highlightly-schemas.js';
import type { NormalizedGame } from './normalized-game.js';
import {
  runLiveValidationTick,
  type LiveValidationDependencies,
  type MatchDetailFetcher,
} from './live-game-validation.js';
import { CurrentGameDetailsSyncService } from './sync-current-game-details.js';
import { CurrentGameSyncService } from './sync-current-games.js';

const gameId = '0768c441-16a6-457c-b50f-e7273d750d77';
const homeTeamId = '8d07dd7a-c2d5-410d-bffc-5c013f88420d';
const awayTeamId = '38c0acd1-35e3-429d-81cf-e37db8bbaf9c';
const providerGameId = '565788';

const policy = {
  nodeEnv: 'development' as const,
  evaluationMode: true,
  publicationApproved: false,
};

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

function providerGame(overrides: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    provider: 'highlightly',
    providerGameId,
    league: 'NFL',
    season: 2026,
    seasonType: 'PRE',
    week: 2,
    startTime: '2026-08-22T23:00:00.000Z',
    status: 'IN_PROGRESS',
    homeProviderTeamId: 'ne-provider',
    awayProviderTeamId: 'phi-provider',
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    homeScore: 7,
    awayScore: 0,
    quarter: 1,
    clock: '9:45',
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: false,
    providerLastUpdatedAt: null,
    ...overrides,
  };
}

function rawPlayDetail(text: string, overrides: { readonly clock?: string } = {}) {
  return {
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
    text,
    type: 'Pass Reception',
    clock: overrides.clock ?? '9:45',
    period: 1,
    isPenalty: false,
  };
}

function rawDetail(options: {
  readonly plays?: readonly ReturnType<typeof rawPlayDetail>[] | undefined;
  readonly homeAbbreviation?: string | undefined;
  readonly teamStatsAvailable?: boolean | undefined;
  readonly id?: number | undefined;
}): HighlightlyDetailedMatch {
  return highlightlyDetailedMatchSchema.parse({
    id: options.id ?? Number(providerGameId),
    round: 'Preseason 2',
    date: '2026-08-22T23:00:00.000Z',
    league: 'NFL',
    season: 2026,
    homeTeam: {
      id: 'ne-provider',
      name: 'Patriots',
      displayName: 'New England Patriots',
      abbreviation: options.homeAbbreviation ?? 'NE',
    },
    awayTeam: {
      id: 'phi-provider',
      name: 'Eagles',
      displayName: 'Philadelphia Eagles',
      abbreviation: 'PHI',
    },
    state: {
      description: 'In Progress',
      score: {
        current: '7 - 0',
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
        playDetails: options.plays ?? [],
      },
    ],
  });
}

function harness(options: {
  readonly plays?: readonly ReturnType<typeof rawPlayDetail>[];
  readonly teamStatsAvailable?: boolean;
  readonly identityMismatch?: boolean;
  readonly gameSyncThrows?: boolean;
  readonly detailFetchFails?: boolean;
  readonly initiallyStoredPlays?: readonly GamePlay[];
}) {
  const gameRecord: CurrentGameRecord = {
    id: gameId,
    season: 2026,
    seasonType: 'PRE',
    week: 2,
    startTime: new Date('2026-08-22T23:00:00.000Z'),
    status: 'IN_PROGRESS',
    homeScore: 7,
    awayScore: 0,
    quarter: 1,
    clock: '9:45',
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    homeTeam: { abbreviation: 'NE', providerTeamId: null },
    awayTeam: { abbreviation: 'PHI', providerTeamId: null },
    providerMapping: { providerGameId },
    editorialResultOverride: null,
  };

  let requestCount = 0;
  const countRequest = (): void => {
    requestCount += 1;
  };

  const gameSyncRepository: CurrentGameSyncRepository = {
    findGame: vi.fn(() => Promise.resolve(gameRecord)),
    findMappedGameId: vi.fn(() => Promise.resolve<string | null>(gameId)),
    findMappedGameOwners: vi.fn(() => Promise.resolve(new Map())),
    applyCurrentGame: vi.fn(() => Promise.resolve()),
  };
  const gameProvider: CurrentGameProvider = {
    providerKey: 'highlightly',
    getCurrentGames: vi.fn(() => {
      countRequest();
      if (options.gameSyncThrows) return Promise.reject(new Error('provider unavailable'));
      return Promise.resolve({
        provider: 'highlightly' as const,
        received: 1,
        records: [providerGame()],
        failures: [],
        requestsUsed: 1,
        responseDurationMs: 20,
      });
    }),
  };

  // Only used by the apply:true (write-capable) fallback path, which never merges requests.
  const detailsTarget: CurrentGameDetailsTarget = {
    id: gameId,
    homeTeamId,
    awayTeamId,
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    providerMapping: { providerGameId },
    teamStats: [],
    playerStats: [],
    playerCoverage: null,
  };
  const detailsRepository: CurrentGameDetailsRepository = {
    findTarget: vi.fn(() => Promise.resolve(detailsTarget)),
    findPlayerMappings: vi.fn(() => Promise.resolve(new Map())),
    applyStats: vi.fn(() => Promise.resolve()),
  };
  const legacyDetail: NormalizedCurrentGameDetails = {
    provider: 'highlightly',
    providerGameId,
    homeProviderTeamId: 'ne-provider',
    awayProviderTeamId: 'phi-provider',
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    homeTeamStats: {
      firstDowns: 5,
      firstDownsPassing: null,
      firstDownsRushing: null,
      firstDownsPenalty: null,
      totalPlays: 12,
      totalYards: 40,
      passingCompletions: null,
      passingAttempts: 6,
      passingYards: 30,
      passingInterceptions: null,
      rushingAttempts: 6,
      rushingYards: 10,
      turnovers: 0,
      fumblesLost: null,
      sacks: null,
      sackYardsLost: null,
      thirdDownConversions: null,
      thirdDownAttempts: null,
      fourthDownConversions: null,
      fourthDownAttempts: null,
      penalties: null,
      penaltyYards: null,
      possessionSeconds: null,
      redZoneConversions: null,
      redZoneAttempts: null,
      totalDrives: null,
    },
    awayTeamStats: {
      firstDowns: 5,
      firstDownsPassing: null,
      firstDownsRushing: null,
      firstDownsPenalty: null,
      totalPlays: 12,
      totalYards: 40,
      passingCompletions: null,
      passingAttempts: 6,
      passingYards: 30,
      passingInterceptions: null,
      rushingAttempts: 6,
      rushingYards: 10,
      turnovers: 0,
      fumblesLost: null,
      sacks: null,
      sackYardsLost: null,
      thirdDownConversions: null,
      thirdDownAttempts: null,
      fourthDownConversions: null,
      fourthDownAttempts: null,
      penalties: null,
      penaltyYards: null,
      possessionSeconds: null,
      redZoneConversions: null,
      redZoneAttempts: null,
      totalDrives: null,
    },
    homePeriodScores: {
      period1: 7,
      period2: null,
      period3: null,
      period4: null,
      overtime1: null,
      overtime2: null,
    },
    awayPeriodScores: {
      period1: 0,
      period2: null,
      period3: null,
      period4: null,
      overtime1: null,
      overtime2: null,
    },
    playerStats: [],
    scoringEventCount: 1,
    playCount: options.plays?.length ?? 0,
    structuredPlayCount: options.plays?.length ?? 0,
  };
  const getGameDetails = vi.fn(() => {
    countRequest();
    return Promise.resolve({
      provider: 'highlightly' as const,
      record: legacyDetail,
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 30,
    });
  });
  const detailsProvider: CurrentGameDetailsProvider = {
    providerKey: 'highlightly',
    getGameDetails,
  };

  let storedPlays: GamePlay[] = [...(options.initiallyStoredPlays ?? [])];
  const applySnapshot = vi.fn((input: CurrentGamePlayApplyInput) => {
    const byId = new Map(storedPlays.map((play) => [play.id, play]));
    for (const row of input.rows) {
      if (row.id === null) {
        const created: GamePlay = { ...row, id: `generated-${String(byId.size + 1)}` } as GamePlay;
        storedPlays = [...storedPlays, created];
      } else {
        storedPlays = storedPlays.map((play) =>
          play.id === row.id ? ({ ...row, id: row.id } as GamePlay) : play,
        );
      }
    }
    return Promise.resolve({ auditEventId: 'audit-event-1' });
  });
  const applyRepair = vi.fn(() =>
    Promise.reject(new Error('applyRepair is not exercised by live-validation tests.')),
  );
  const findTarget = vi.fn(() =>
    Promise.resolve<CurrentGamePlayTarget>({
      id: gameId,
      status: 'IN_PROGRESS',
      homeTeamId,
      awayTeamId,
      homeAbbreviation: 'NE',
      awayAbbreviation: 'PHI',
      providerMapping: { providerGameId },
      plays: storedPlays,
    }),
  );
  const replaceWithAuthoritativeFinalSnapshot = vi.fn(() =>
    Promise.reject(
      new Error('replaceWithAuthoritativeFinalSnapshot is not exercised by live-validation tests.'),
    ),
  );
  const playRepository: CurrentGamePlayRepository = {
    findTarget,
    applySnapshot,
    applyRepair,
    replaceWithAuthoritativeFinalSnapshot,
  };
  const getGamePlays = vi.fn((): Promise<CurrentGamePlayBatch> => {
    countRequest();
    return Promise.resolve({
      provider: 'highlightly',
      record: {
        provider: 'highlightly',
        providerGameId,
        homeProviderTeamId: 'ne-provider',
        awayProviderTeamId: 'phi-provider',
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        plays: [],
        providerUpdatedAt: null,
      },
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 15,
      normalizationDurationMs: 1,
    });
  });
  const playProvider: CurrentGamePlayProvider = {
    providerKey: 'highlightly',
    getGamePlays,
  };

  // The optimized diagnostic-only path: one shared fetch feeds both real normalizers.
  const fetchMatchDetail = vi.fn(() => {
    countRequest();
    if (options.detailFetchFails) {
      return Promise.resolve({ detail: null, failureReason: 'Detailed match failed validation.' });
    }
    return Promise.resolve({
      detail: rawDetail({
        plays: options.plays,
        homeAbbreviation: options.identityMismatch ? 'BUF' : 'NE',
        teamStatsAvailable: options.teamStatsAvailable,
      }),
      failureReason: null,
    });
  });
  const matchDetailFetcher: MatchDetailFetcher = { fetch: fetchMatchDetail };

  const deps: LiveValidationDependencies = {
    gameSyncService: new CurrentGameSyncService(gameProvider, gameSyncRepository),
    detailsService: new CurrentGameDetailsSyncService(detailsProvider, detailsRepository),
    playProvider,
    playRepository,
    matchDetailFetcher,
    requestCounter: { getRequestCount: () => requestCount },
    rateLimitObservation: () => ({ limit: 100, remaining: 96 }),
    now: () => new Date('2026-08-22T23:05:00.000Z'),
  };
  return {
    deps,
    fetchMatchDetail,
    getGameDetails,
    getGamePlays,
    applySnapshot,
    getStoredPlays: () => storedPlays,
  };
}

describe('runLiveValidationTick', () => {
  it('reports provider status, team-stat coverage, and normalized plays using ~2 requests/tick', async () => {
    const { deps } = harness({ plays: [rawPlayDetail('original')] });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });

    expect(result.record.gameState.outcome.ok).toBe(true);
    expect(result.record.gameState.providerStatus).toBe('IN_PROGRESS');
    expect(result.record.gameState.homeScore).toBe(7);
    expect(result.record.teamStats.outcome.ok).toBe(true);
    expect(result.record.teamStats.rowCount).toBe(2);
    expect(result.record.teamStats.classification).toBe('COMPLETE');
    expect(result.record.plays.outcome.ok).toBe(true);
    expect(result.record.plays.normalizedPlayCount).toBe(1);
    expect(result.record.plays.newlyObservedThisTick).toHaveLength(1);
    expect(result.syntheticPlays).toHaveLength(1);
    // 1 game-state/schedule request + 1 shared match-detail request, not 3.
    expect(result.record.requestUsageDelta).toBe(2);
  });

  it('reports team-stats unavailable pregame without blocking play observation', async () => {
    const { deps } = harness({ plays: [], teamStatsAvailable: false });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });
    expect(result.record.teamStats.outcome.ok).toBe(false);
    expect(result.record.teamStats.outcome.errorCategory).toBe('CURRENT_GAME_DETAILS_INVALID');
    expect(result.record.plays.outcome.ok).toBe(true);
    expect(result.record.plays.normalizedPlayCount).toBe(0);
    expect(result.record.requestUsageDelta).toBe(2);
  });

  it('diffs against the previous tick: a corrected description updates, a new play inserts', async () => {
    const { deps } = harness({ plays: [rawPlayDetail('original')] });
    const firstObservedAt = new Map<string, string>();
    const first = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt,
    });
    expect(first.record.plays.newlyObservedThisTick).toHaveLength(1);
    const firstObservedTimestamp = [...firstObservedAt.values()][0];

    const { deps: nextDeps } = harness({
      plays: [rawPlayDetail('corrected'), rawPlayDetail('brand new play', { clock: '8:10' })],
    });
    const second = await runLiveValidationTick(nextDeps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 2,
      previousPlays: first.syntheticPlays,
      firstObservedAt,
    });

    expect(second.record.plays.vsPreviousTick).toEqual(
      expect.objectContaining({ inserted: 1, updated: 1, unchanged: 0 }),
    );
    expect(second.record.plays.newlyObservedThisTick).toHaveLength(1);
    expect(second.record.plays.newlyObservedThisTick[0]?.description).toBe('brand new play');
    // The corrected play's structural identity was already observed in tick 1;
    // its first-observed timestamp must not move even though its text changed.
    expect(firstObservedAt.size).toBe(2);
    expect([...firstObservedAt.values()][0]).toBe(firstObservedTimestamp);
  });

  it('throws GAME_NOT_FOUND when the internal game cannot be found', async () => {
    const { deps } = harness({});
    deps.playRepository.findTarget = vi.fn(() => Promise.resolve(null));
    await expect(
      runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: false,
        policy,
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
  });

  it('throws GAME_PROVIDER_MAPPING_REQUIRED when no Highlightly mapping is verified', async () => {
    const { deps } = harness({});
    const target = await deps.playRepository.findTarget(gameId, 'highlightly');
    deps.playRepository.findTarget = vi.fn(() =>
      Promise.resolve(target === null ? null : { ...target, providerMapping: null }),
    );
    await expect(
      runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: false,
        policy,
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'GAME_PROVIDER_MAPPING_REQUIRED' });
  });

  it('flags an identity mismatch instead of normalizing plays or stats from the wrong game', async () => {
    const { deps } = harness({ plays: [rawPlayDetail('original')], identityMismatch: true });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });
    expect(result.record.plays.outcome.ok).toBe(false);
    expect(result.record.plays.outcome.errorCategory).toBe('CURRENT_GAME_PLAYS_IDENTITY_MISMATCH');
    expect(result.record.plays.normalizedPlayCount).toBeNull();
  });

  it('surfaces the shared fetch failure to both surfaces when the match detail is unavailable', async () => {
    const { deps } = harness({ detailFetchFails: true });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });
    expect(result.record.teamStats.outcome.errorCategory).toBe('CURRENT_GAME_DETAILS_INVALID');
    expect(result.record.plays.outcome.errorCategory).toBe('CURRENT_GAME_PLAYS_INVALID');
    expect(result.record.requestUsageDelta).toBe(2);
  });

  it('keeps game-state, team-stat, and play observation independent when one fails', async () => {
    const { deps } = harness({ plays: [rawPlayDetail('original')], gameSyncThrows: true });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: false,
      applyPlays: false,
      policy,
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });
    expect(result.record.gameState.outcome.ok).toBe(false);
    expect(result.record.teamStats.outcome.ok).toBe(true);
    expect(result.record.plays.outcome.ok).toBe(true);
    expect(result.record.plays.normalizedPlayCount).toBe(1);
  });

  it('apply:true uses the untouched, write-capable production services at full request cost', async () => {
    const { deps, fetchMatchDetail, getGameDetails, getGamePlays } = harness({
      plays: [rawPlayDetail('original')],
    });
    const result = await runLiveValidationTick(deps, {
      gameId,
      apply: true,
      applyPlays: false,
      policy: { ...policy, publicationApproved: true },
      tickIndex: 1,
      previousPlays: [],
      firstObservedAt: new Map(),
    });
    expect(getGameDetails).toHaveBeenCalledTimes(1);
    expect(getGamePlays).toHaveBeenCalledTimes(1);
    expect(fetchMatchDetail).not.toHaveBeenCalled();
    // Unoptimized fallback: game-state + team-stats + plays = 3 requests, unchanged.
    expect(result.record.requestUsageDelta).toBe(3);
  });

  describe('--applyPlays live GamePlay persistence', () => {
    it('does not write GamePlay rows unless --applyPlays is explicitly requested', async () => {
      const { deps, applySnapshot } = harness({ plays: [rawPlayDetail('original')] });
      const result = await runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: false,
        policy: { ...policy, publicationApproved: true },
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      });
      expect(result.record.plays.write).toEqual({
        requested: false,
        applied: false,
        skippedReason: null,
        storedTotal: 0,
      });
      expect(applySnapshot).not.toHaveBeenCalled();
    });

    it('refuses to write without HIGHLIGHTLY_PUBLICATION_APPROVED even when --applyPlays is requested', async () => {
      const { deps, applySnapshot } = harness({ plays: [rawPlayDetail('original')] });
      const result = await runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: true,
        policy, // publicationApproved: false
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      });
      expect(result.record.plays.write).toEqual({
        requested: true,
        applied: false,
        skippedReason: 'PUBLICATION_NOT_APPROVED',
        storedTotal: 0,
      });
      expect(applySnapshot).not.toHaveBeenCalled();
    });

    it('inserts newly observed live plays through the real M26 persistence path when approved', async () => {
      const { deps, applySnapshot, getStoredPlays } = harness({
        plays: [rawPlayDetail('first play'), rawPlayDetail('second play', { clock: '8:30' })],
      });
      const result = await runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: true,
        policy: { ...policy, publicationApproved: true },
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      });
      expect(result.record.plays.write).toEqual({
        requested: true,
        applied: true,
        skippedReason: null,
        storedTotal: 2,
      });
      expect(applySnapshot).toHaveBeenCalledTimes(1);
      expect(getStoredPlays()).toHaveLength(2);
      // Backend IDs come from the repository, not the diagnostic layer.
      expect(getStoredPlays().every((play) => play.id.length > 0)).toBe(true);
    });

    it('safely updates a deterministically matched corrected play on the next tick', async () => {
      const { deps, applySnapshot, getStoredPlays } = harness({
        plays: [rawPlayDetail('original text')],
      });
      const first = await runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: true,
        policy: { ...policy, publicationApproved: true },
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      });
      expect(first.record.plays.write.applied).toBe(true);
      expect(applySnapshot).toHaveBeenCalledTimes(1);
      const storedId = getStoredPlays()[0]?.id;

      const {
        deps: nextDeps,
        applySnapshot: nextApplySnapshot,
        getStoredPlays: getNextStoredPlays,
      } = harness({
        plays: [rawPlayDetail('corrected text')],
        initiallyStoredPlays: getStoredPlays(),
      });
      const second = await runLiveValidationTick(nextDeps, {
        gameId,
        apply: false,
        applyPlays: true,
        policy: { ...policy, publicationApproved: true },
        tickIndex: 2,
        previousPlays: first.syntheticPlays,
        firstObservedAt: new Map(),
      });
      expect(second.record.plays.vsStoredDb).toEqual(
        expect.objectContaining({ inserted: 0, updated: 1, unchanged: 0 }),
      );
      expect(second.record.plays.write).toEqual({
        requested: true,
        applied: true,
        skippedReason: null,
        storedTotal: 1,
      });
      expect(nextApplySnapshot).toHaveBeenCalledTimes(1);
      const correctedPlays = getNextStoredPlays();
      expect(correctedPlays).toHaveLength(1);
      // The stable backend ID is preserved across the correction, not regenerated.
      expect(correctedPlays[0]?.id).toBe(storedId);
      expect(correctedPlays[0]?.description).toBe('corrected text');
    });

    it('never deletes stored plays when the live snapshot shrinks: blocks the whole write instead', async () => {
      const survivingStoredPlay: GamePlay = {
        id: 'stored-play-1',
        gameId,
        playKey: 'stored-play-key-not-in-new-snapshot',
        reconciliationKey: 'stored-reconciliation-key-not-in-new-snapshot',
        sequence: 1,
        period: 1,
        clock: '10:00',
        possessionTeamId: null,
        playType: 'RUSH',
        description: 'A previously observed live play',
        startDown: null,
        startDistance: null,
        startYardLine: null,
        endDown: null,
        endDistance: null,
        endYardLine: null,
        isScoringPlay: false,
        isPenalty: false,
        isTurnover: false,
        sourceProvider: 'highlightly',
        sourcePlayType: 'Rush',
        sourceUpdatedAt: new Date('2026-08-22T23:00:00.000Z'),
        supersededAt: null,
        supersededByRunId: null,
        createdAt: new Date('2026-08-22T23:00:00.000Z'),
        updatedAt: new Date('2026-08-22T23:00:00.000Z'),
      };
      const { deps, applySnapshot, getStoredPlays } = harness({
        plays: [rawPlayDetail('a different play the provider now shows')],
        initiallyStoredPlays: [survivingStoredPlay],
      });
      const result = await runLiveValidationTick(deps, {
        gameId,
        apply: false,
        applyPlays: true,
        policy: { ...policy, publicationApproved: true },
        tickIndex: 1,
        previousPlays: [],
        firstObservedAt: new Map(),
      });
      expect(result.record.plays.write).toEqual({
        requested: true,
        applied: false,
        skippedReason: 'BLOCKED_COLLISION_OR_UNMATCHED',
        storedTotal: 1,
      });
      expect(applySnapshot).not.toHaveBeenCalled();
      expect(getStoredPlays()).toEqual([survivingStoredPlay]);
    });
  });
});
