import { describe, expect, it, vi } from 'vitest';

import type { GamePlay } from '../../generated/prisma/client.js';
import type { CurrentGameProvider } from './current-game-provider.js';
import type {
  CurrentGameRecord,
  CurrentGameSyncRepository,
} from './current-game-sync.repository.js';
import type {
  CurrentGameDetailsApplyInput,
  CurrentGameDetailsRepository,
  CurrentGameDetailsTarget,
} from './current-game-details.repository.js';
import type {
  CurrentGamePlayApplyInput,
  CurrentGamePlayFinalReplaceInput,
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import type { CurrentGamePlayProvider } from './current-game-play-provider.js';
import { FinalPlaySnapshotService } from './current-game-play-final-replacement.js';
import type {
  ClaimedPoll,
  CurrentGamePollStateRepository,
  PollCandidateGame,
  PollStateOutcomeUpdate,
  PollStateRow,
} from './current-game-poll-state.repository.js';
import type { HighlightlyDetailedMatch } from './evaluation/highlightly/highlightly-schemas.js';
import { highlightlyDetailedMatchSchema } from './evaluation/highlightly/highlightly-schemas.js';
import type { MatchDetailFetcher } from './live-game-validation.js';
import type { NormalizedGame } from './normalized-game.js';
import {
  CurrentGamePoller,
  shouldPollWhileDegraded,
  type CurrentGamePollerOptions,
} from './current-game-poller.js';
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
    start: { down: 1, distance: 10, yardLine: 25, possessionText: 'PHI 25', yardsToEndzone: 75 },
    end: { down: 1, distance: 5, yardLine: 30, possessionText: 'PHI 30', yardsToEndzone: 70 },
    text,
    type: 'Pass Reception',
    clock: overrides.clock ?? '9:45',
    period: 1,
    isPenalty: false,
  };
}

function rawDetail(options: {
  readonly plays?: readonly ReturnType<typeof rawPlayDetail>[] | undefined;
  readonly teamStatsAvailable?: boolean | undefined;
  readonly providerGameId?: string | undefined;
}): HighlightlyDetailedMatch {
  return highlightlyDetailedMatchSchema.parse({
    id: Number(options.providerGameId ?? providerGameId),
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

type MutableState = { -readonly [Key in keyof PollStateRow]: PollStateRow[Key] } & {
  lockedAt: Date | null;
  lockedBy: string | null;
};

function createFakePollStateRepository(games: readonly PollCandidateGame[]) {
  // Keyed by the poll state's own id (matching the real repository's contract, where
  // recordSuccess/recordFailure/claimDue's row identity is the poll state id, not the game id).
  const states = new Map<string, MutableState>();
  const gameById = new Map(games.map((game) => [game.gameId, game]));
  const findByGameId = (gameId: string): MutableState | undefined =>
    [...states.values()].find((state) => state.gameId === gameId);
  let counter = 0;

  const repository: CurrentGamePollStateRepository = {
    discoverCandidates: () => Promise.resolve(games),
    ensurePollStates: (gameIds, now) => {
      for (const id of gameIds) {
        if (findByGameId(id) !== undefined) continue;
        counter += 1;
        const pollId = `poll-${String(counter)}`;
        states.set(pollId, {
          id: pollId,
          gameId: id,
          schedulingClass: 'NOT_DUE',
          featuredReason: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          nextPollAt: now,
          lastObservedStatus: null,
          lastError: null,
          finalObservedAt: null,
          finalImmediateCompletedAt: null,
          final10CompletedAt: null,
          final60CompletedAt: null,
          playsBlockedAt: null,
          playsBlockReason: null,
          playsReviewRequired: false,
          lockedAt: null,
          lockedBy: null,
        });
      }
      return Promise.resolve();
    },
    claimDue: (now, workerId, leaseMs, limit) => {
      const staleBefore = new Date(now.getTime() - leaseMs);
      const claimed: ClaimedPoll[] = [];
      for (const state of states.values()) {
        if (claimed.length >= limit) break;
        if (state.nextPollAt === null || state.nextPollAt.getTime() > now.getTime()) continue;
        if (state.lockedAt !== null && state.lockedAt.getTime() >= staleBefore.getTime()) continue;
        const game = gameById.get(state.gameId);
        if (game === undefined) continue;
        state.lockedAt = now;
        state.lockedBy = workerId;
        state.lastAttemptAt = now;
        claimed.push({ pollState: { ...state }, game });
      }
      return Promise.resolve(claimed);
    },
    recordSuccess: (id, now, update: PollStateOutcomeUpdate) => {
      const state = states.get(id);
      if (state === undefined) return Promise.resolve();
      state.schedulingClass = update.schedulingClass;
      state.featuredReason = update.featuredReason;
      state.nextPollAt = update.nextPollAt;
      state.lastObservedStatus = update.lastObservedStatus;
      state.lastSuccessAt = now;
      state.lastError = null;
      state.lockedAt = null;
      state.lockedBy = null;
      if (update.finalObservedAt !== undefined) state.finalObservedAt = update.finalObservedAt;
      if (update.finalImmediateCompletedAt !== undefined) {
        state.finalImmediateCompletedAt = update.finalImmediateCompletedAt;
      }
      if (update.final10CompletedAt !== undefined)
        state.final10CompletedAt = update.final10CompletedAt;
      if (update.final60CompletedAt !== undefined)
        state.final60CompletedAt = update.final60CompletedAt;
      state.playsBlockedAt = update.playsBlock.playsBlockedAt;
      state.playsBlockReason = update.playsBlock.playsBlockReason;
      state.playsReviewRequired = update.playsBlock.playsReviewRequired;
      return Promise.resolve();
    },
    recordFailure: (id, now, error, retryNextPollAt, playsBlock) => {
      const state = states.get(id);
      if (state === undefined) return Promise.resolve();
      state.lastError = error;
      state.nextPollAt = retryNextPollAt;
      state.playsBlockedAt = playsBlock.playsBlockedAt;
      state.playsBlockReason = playsBlock.playsBlockReason;
      state.playsReviewRequired = playsBlock.playsReviewRequired;
      state.lockedAt = null;
      state.lockedBy = null;
      state.lastAttemptAt = now;
      return Promise.resolve();
    },
    listPlaysReviewRequired: (limit) =>
      Promise.resolve(
        [...states.values()]
          .filter((state) => state.playsReviewRequired)
          .slice(0, limit)
          .map((state) => ({
            gameId: state.gameId,
            playsBlockedAt: state.playsBlockedAt,
            playsBlockReason: state.playsBlockReason,
          })),
      ),
    clearPlaysBlock: (gameId) => {
      const state = findByGameId(gameId);
      if (state !== undefined) {
        state.playsBlockedAt = null;
        state.playsBlockReason = null;
        state.playsReviewRequired = false;
      }
      return Promise.resolve();
    },
  };
  return {
    repository,
    states,
    setNextPollAt: (id: string, at: Date) => {
      const state = [...states.values()].find((candidate) => candidate.gameId === id);
      if (state !== undefined) state.nextPollAt = at;
    },
  };
}

function harness(options: {
  readonly gameStatus?: NormalizedGame['status'];
  readonly plays?: readonly ReturnType<typeof rawPlayDetail>[];
  readonly detailFetchFails?: boolean;
  readonly gameSyncThrows?: boolean;
  readonly initiallyStoredPlays?: readonly GamePlay[];
  readonly manualFeatured?: boolean | null;
  readonly broadcastNetwork?: string | null;
  readonly rateLimitRemaining?: number | null;
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
    broadcastNetwork: options.broadcastNetwork ?? null,
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
        records: [providerGame({ status: options.gameStatus ?? 'IN_PROGRESS' })],
        failures: [],
        requestsUsed: 1,
        responseDurationMs: 20,
      });
    }),
  };

  let storedTeamStats: CurrentGameDetailsApplyInput['rows'] = [];
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
    findTarget: vi.fn(() =>
      Promise.resolve({
        ...detailsTarget,
        teamStats: storedTeamStats as unknown as CurrentGameDetailsTarget['teamStats'],
      }),
    ),
    findPlayerMappings: vi.fn(() => Promise.resolve(new Map())),
    applyStats: vi.fn((input: CurrentGameDetailsApplyInput) => {
      storedTeamStats = input.rows;
      return Promise.resolve();
    }),
  };

  let storedPlays: GamePlay[] = [...(options.initiallyStoredPlays ?? [])];
  const applySnapshot = vi.fn((input: CurrentGamePlayApplyInput) => {
    for (const row of input.rows) {
      if (row.id === null) {
        storedPlays = [
          ...storedPlays,
          { ...row, id: `generated-${String(storedPlays.length + 1)}` } as GamePlay,
        ];
      } else {
        storedPlays = storedPlays.map((play) =>
          play.id === row.id ? ({ ...row, id: row.id } as GamePlay) : play,
        );
      }
    }
    return Promise.resolve({ auditEventId: 'audit-event-1' });
  });
  const applyRepair = vi.fn(() =>
    Promise.reject(new Error('applyRepair is not exercised by poller tests.')),
  );
  const replaceWithAuthoritativeFinalSnapshot = vi.fn((input: CurrentGamePlayFinalReplaceInput) => {
    storedPlays = input.rows.map(
      (row, index) => ({ ...row, id: `final-generated-${String(index + 1)}` }) as GamePlay,
    );
    return Promise.resolve({ auditEventId: 'audit-event-final-replace' });
  });
  const playRepository: CurrentGamePlayRepository = {
    findTarget: vi.fn(() =>
      Promise.resolve<CurrentGamePlayTarget>({
        id: gameId,
        status: options.gameStatus ?? 'IN_PROGRESS',
        homeTeamId,
        awayTeamId,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        providerMapping: { providerGameId },
        plays: storedPlays,
      }),
    ),
    applySnapshot,
    applyRepair,
    replaceWithAuthoritativeFinalSnapshot,
  };
  const finalPlayProviderStub: CurrentGamePlayProvider = {
    providerKey: 'highlightly',
    getGamePlays: () =>
      Promise.reject(new Error('not exercised — the poller always supplies playsSnapshot')),
  };
  const finalPlaySnapshotService = new FinalPlaySnapshotService(
    finalPlayProviderStub,
    playRepository,
    () => now,
  );

  const fetchMatchDetail = vi.fn(() => {
    countRequest();
    if (options.detailFetchFails) {
      return Promise.resolve({ detail: null, failureReason: 'Detailed match failed validation.' });
    }
    return Promise.resolve({ detail: rawDetail({ plays: options.plays }), failureReason: null });
  });
  const matchDetailFetcher: MatchDetailFetcher = { fetch: fetchMatchDetail };

  const candidate: PollCandidateGame = {
    gameId,
    status: options.gameStatus ?? 'IN_PROGRESS',
    startTime: new Date('2026-08-22T23:00:00.000Z'),
    quarter: 1,
    homeScore: 7,
    awayScore: 0,
    manualFeatured: options.manualFeatured ?? null,
    broadcastNetwork: options.broadcastNetwork ?? null,
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    providerMapping: { providerGameId },
  };
  const {
    repository: pollStateRepository,
    states,
    setNextPollAt,
  } = createFakePollStateRepository([candidate]);

  let rateLimitRemaining = options.rateLimitRemaining ?? 7_000;
  let now = new Date('2026-08-23T00:00:00.000Z');
  const poller = new CurrentGamePoller({
    gameSyncService: new CurrentGameSyncService(gameProvider, gameSyncRepository),
    detailsRepository,
    playRepository,
    finalPlaySnapshotService,
    matchDetailFetcher,
    pollStateRepository,
    requestCounter: { getRequestCount: () => requestCount },
    rateLimitObservation: () => ({ limit: 7_500, remaining: rateLimitRemaining }),
    now: () => now,
    workerId: 'worker-a',
  });
  const setNow = (value: Date): void => {
    now = value;
  };
  const setRateLimitRemaining = (value: number): void => {
    rateLimitRemaining = value;
  };

  const options_: CurrentGamePollerOptions = {
    schedulingConfig: {
      pregamePollSeconds: 300,
      livePollSeconds: 120,
      featuredPollSeconds: 60,
      halftimePollSeconds: 180,
      finalReconcile10Minutes: 10,
      finalReconcile60Minutes: 60,
    },
    policy,
    lockLeaseSeconds: 120,
    batchSize: 10,
    rateLimitDegradeThreshold: 500,
  };

  return {
    poller,
    options: options_,
    states,
    setNextPollAt,
    applySnapshot,
    replaceWithAuthoritativeFinalSnapshot,
    getStoredPlays: () => storedPlays,
    candidate,
    pollStateRepository,
    setRateLimitRemaining,
    fetchMatchDetail,
    setNow,
  };
}

describe('CurrentGamePoller', () => {
  it('polls a due live game, writes game state and plays, and schedules the next poll', async () => {
    const { poller, options, states } = harness({ plays: [rawPlayDetail('first play')] });
    const report = await poller.runCycle(options);
    expect(report.claimed).toBe(1);
    expect(report.ticks).toHaveLength(1);
    const tick = report.ticks[0];
    expect(tick?.gameState.ok).toBe(true);
    expect(tick?.plays.inserted).toBe(1);
    expect(tick?.schedulingClassAfter).toBe('LIVE_NORMAL');
    expect(tick?.requestUsageDelta).toBe(2); // one game-state request + one merged match-detail request
    const state = [...states.values()][0];
    expect(state?.nextPollAt).toEqual(new Date('2026-08-23T00:02:00.000Z')); // +120s
    expect(state?.lockedAt).toBeNull();
  });

  it('does not re-claim a game already locked by another in-flight worker', async () => {
    const { poller, options, states, pollStateRepository } = harness({});
    // Simulate a previous cycle claiming this row and never finishing (still locked).
    await pollStateRepository.ensurePollStates([gameId], new Date('2026-08-23T00:00:00.000Z'));
    const state = [...states.values()][0];
    if (state === undefined) throw new Error('expected a poll state row');
    state.lockedAt = new Date('2026-08-22T23:59:30.000Z'); // 30s ago, well inside the 120s lease
    state.lockedBy = 'worker-b';
    const report = await poller.runCycle(options);
    expect(report.claimed).toBe(0);
    expect(report.ticks).toHaveLength(0);
  });

  it('claims a game whose lock has gone stale past the lease', async () => {
    const { poller, options, states, pollStateRepository } = harness({});
    await pollStateRepository.ensurePollStates([gameId], new Date('2026-08-23T00:00:00.000Z'));
    const state = [...states.values()][0];
    if (state === undefined) throw new Error('expected a poll state row');
    state.lockedAt = new Date('2026-08-22T23:57:00.000Z'); // 3 minutes ago, past the 120s lease
    state.lockedBy = 'worker-b';
    const report = await poller.runCycle(options);
    expect(report.claimed).toBe(1);
  });

  it('preserves prior state and schedules a retry when the provider fetch fails', async () => {
    const { poller, options, states } = harness({ gameSyncThrows: true });
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.gameState.ok).toBe(false);
    const after = [...states.values()][0];
    expect(after?.lastObservedStatus).toBeNull(); // untouched by the failed tick, not clobbered
    expect(after?.nextPollAt).not.toBeNull();
    expect(after?.lastError).not.toBeNull();
    expect(after?.lockedAt).toBeNull(); // released, not stuck
  });

  it('does not let one failing game block others claimed in the same cycle', async () => {
    const okGameId = '11111111-1111-4111-8111-111111111111';
    const okProviderGameId = '900001';
    const gameSyncRepository: CurrentGameSyncRepository = {
      findGame: vi.fn((id: string) =>
        Promise.resolve<CurrentGameRecord>({
          id,
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
          providerMapping: { providerGameId: id === gameId ? providerGameId : okProviderGameId },
          editorialResultOverride: null,
        }),
      ),
      findMappedGameId: vi.fn(() => Promise.resolve<string | null>(null)),
      findMappedGameOwners: vi.fn(() => Promise.resolve(new Map())),
      applyCurrentGame: vi.fn(() => Promise.resolve()),
    };
    // Both games share this provider stub and both fail their game-state step here (a
    // per-game window query can't be faked to fail selectively in this fixture) — what this
    // test actually proves is that the OK game's independent play-write path below still runs
    // to completion after the failing game's tick, i.e. the poller's per-claim loop does not
    // abort on one game's error.
    const gameProvider: CurrentGameProvider = {
      providerKey: 'highlightly',
      getCurrentGames: vi.fn(() => Promise.reject(new Error('provider unavailable'))),
    };
    const playTargets = new Map<string, CurrentGamePlayTarget>([
      [
        okGameId,
        {
          id: okGameId,
          status: 'IN_PROGRESS',
          homeTeamId,
          awayTeamId,
          homeAbbreviation: 'NE',
          awayAbbreviation: 'PHI',
          providerMapping: { providerGameId: okProviderGameId },
          plays: [],
        },
      ],
    ]);
    const applySnapshot = vi.fn(() => Promise.resolve({ auditEventId: 'audit-event-1' }));
    const applyRepair = vi.fn(() =>
      Promise.reject(new Error('applyRepair is not exercised by this test.')),
    );
    const playRepository: CurrentGamePlayRepository = {
      findTarget: vi.fn((id: string) => Promise.resolve(playTargets.get(id) ?? null)),
      applySnapshot,
      applyRepair,
      replaceWithAuthoritativeFinalSnapshot: () =>
        Promise.reject(new Error('not exercised by this test.')),
    };
    const finalPlaySnapshotService = new FinalPlaySnapshotService(
      {
        providerKey: 'highlightly',
        getGamePlays: () => Promise.reject(new Error('not exercised by this test.')),
      },
      playRepository,
    );
    const detailsRepository: CurrentGameDetailsRepository = {
      findTarget: vi.fn((id: string) =>
        Promise.resolve<CurrentGameDetailsTarget>({
          id,
          homeTeamId,
          awayTeamId,
          homeAbbreviation: 'NE',
          awayAbbreviation: 'PHI',
          providerMapping: { providerGameId: okProviderGameId },
          teamStats: [],
          playerStats: [],
          playerCoverage: null,
        }),
      ),
      findPlayerMappings: vi.fn(() => Promise.resolve(new Map())),
      applyStats: vi.fn(() => Promise.resolve()),
    };
    const candidates: PollCandidateGame[] = [
      {
        gameId,
        status: 'IN_PROGRESS',
        startTime: new Date('2026-08-22T23:00:00.000Z'),
        quarter: 1,
        homeScore: 7,
        awayScore: 0,
        manualFeatured: null,
        broadcastNetwork: null,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        providerMapping: { providerGameId },
      },
      {
        gameId: okGameId,
        status: 'IN_PROGRESS',
        startTime: new Date('2026-08-22T23:00:00.000Z'),
        quarter: 1,
        homeScore: 7,
        awayScore: 0,
        manualFeatured: null,
        broadcastNetwork: null,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        providerMapping: { providerGameId: okProviderGameId },
      },
    ];
    const { repository: pollStateRepository } = createFakePollStateRepository(candidates);

    const poller = new CurrentGamePoller({
      gameSyncService: new CurrentGameSyncService(gameProvider, gameSyncRepository),
      detailsRepository,
      playRepository,
      finalPlaySnapshotService,
      matchDetailFetcher: {
        fetch: (id) =>
          Promise.resolve({
            detail: rawDetail({
              providerGameId: id,
              plays: id === okProviderGameId ? [rawPlayDetail('ok game play')] : [],
            }),
            failureReason: null,
          }),
      },
      pollStateRepository,
      requestCounter: { getRequestCount: () => 0 },
      rateLimitObservation: () => ({ limit: 7_500, remaining: 7_000 }),
      now: () => new Date('2026-08-23T00:00:00.000Z'),
      workerId: 'worker-a',
    });

    const options: CurrentGamePollerOptions = {
      schedulingConfig: {
        pregamePollSeconds: 300,
        livePollSeconds: 120,
        featuredPollSeconds: 60,
        halftimePollSeconds: 180,
        finalReconcile10Minutes: 10,
        finalReconcile60Minutes: 60,
      },
      policy,
      lockLeaseSeconds: 120,
      batchSize: 10,
      rateLimitDegradeThreshold: 500,
    };

    const report = await poller.runCycle(options);
    expect(report.claimed).toBe(2);
    expect(report.ticks).toHaveLength(2);
    const failedTick = report.ticks.find((tick) => tick.gameId === gameId);
    const okTick = report.ticks.find((tick) => tick.gameId === okGameId);
    expect(failedTick?.gameState.ok).toBe(false);
    // The other game's own game-state write still failed too (shared gameProvider stub),
    // but its play write path — independent of the failing game — still executed cleanly,
    // proving one game's failure does not abort the cycle's loop over the rest.
    expect(okTick?.plays.inserted).toBe(1);
    expect(applySnapshot).toHaveBeenCalledTimes(1);
  });

  it('never deletes stored plays when the live snapshot shrinks: blocks the write', async () => {
    const survivingPlay: GamePlay = {
      id: 'stored-1',
      gameId,
      playKey: 'stored-play-key-not-in-new-snapshot',
      reconciliationKey: 'stored-reconciliation-key-not-in-new-snapshot',
      sequence: 1,
      period: 1,
      clock: '10:00',
      possessionTeamId: null,
      playType: 'RUSH',
      description: 'previously observed live play',
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
    const { poller, options, applySnapshot, getStoredPlays } = harness({
      plays: [rawPlayDetail('a different play now shown')],
      initiallyStoredPlays: [survivingPlay],
    });
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.plays.blocked).toBe(true);
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(getStoredPlays()).toEqual([survivingPlay]);
  });

  it('persists a durable block via recordSuccess on first occurrence (a block never fails the cycle)', async () => {
    const survivingPlay: GamePlay = {
      id: 'stored-1',
      gameId,
      playKey: 'stored-play-key-not-in-new-snapshot',
      reconciliationKey: 'stored-reconciliation-key-not-in-new-snapshot',
      sequence: 1,
      period: 1,
      clock: '10:00',
      possessionTeamId: null,
      playType: 'RUSH',
      description: 'previously observed live play',
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
    const { poller, options, states } = harness({
      plays: [rawPlayDetail('a different play now shown')],
      initiallyStoredPlays: [survivingPlay],
    });
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.plays.blocked).toBe(true);
    expect(report.ticks[0]?.plays.blockReason).toBe('UNMATCHED_EXISTING');
    expect(report.ticks[0]?.gameState.ok).toBe(true);
    const state = [...states.values()][0];
    expect(state?.playsBlockedAt).toEqual(new Date('2026-08-23T00:00:00.000Z'));
    expect(state?.playsBlockReason).toBe('UNMATCHED_EXISTING');
    expect(state?.playsReviewRequired).toBe(true);
    // recordSuccess (not recordFailure) is the path used — confirmed by lastError staying null and
    // the row being unlocked exactly as any other successful tick.
    expect(state?.lastError).toBeNull();
    expect(state?.lockedAt).toBeNull();
  });

  it('preserves the original playsBlockedAt across a repeat blocked tick', async () => {
    const survivingPlay: GamePlay = {
      id: 'stored-1',
      gameId,
      playKey: 'stored-play-key-not-in-new-snapshot',
      reconciliationKey: 'stored-reconciliation-key-not-in-new-snapshot',
      sequence: 1,
      period: 1,
      clock: '10:00',
      possessionTeamId: null,
      playType: 'RUSH',
      description: 'previously observed live play',
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
    const { poller, options, states, setNextPollAt, setNow } = harness({
      plays: [rawPlayDetail('a different play now shown')],
      initiallyStoredPlays: [survivingPlay],
    });

    const firstTick = new Date('2026-08-23T00:00:00.000Z');
    setNow(firstTick);
    const firstReport = await poller.runCycle(options);
    expect(firstReport.ticks[0]?.plays.blocked).toBe(true);
    const gamePollId = [...states.keys()][0];
    if (gamePollId === undefined) throw new Error('expected a poll state row');
    expect(states.get(gamePollId)?.playsBlockedAt).toEqual(firstTick);

    setNextPollAt(gameId, firstTick);
    const secondTick = new Date('2026-08-23T00:05:00.000Z');
    setNow(secondTick);
    const secondReport = await poller.runCycle(options);
    expect(secondReport.ticks[0]?.plays.blocked).toBe(true);
    // Still blocked on the second tick — but the original block timestamp is preserved rather
    // than being re-stamped to the second tick's time, so operators can see how long it's stuck.
    expect(states.get(gamePollId)?.playsBlockedAt).toEqual(firstTick);
    expect(states.get(gamePollId)?.playsBlockReason).toBe('UNMATCHED_EXISTING');
  });

  it('clears a durable block automatically once a later snapshot reconciles cleanly (no repair action involved)', async () => {
    const { poller, options, states, setNextPollAt, setNow, fetchMatchDetail, getStoredPlays } =
      harness({ plays: [rawPlayDetail('original')] });

    // Tick 1: insert the initial play cleanly.
    setNow(new Date('2026-08-23T00:00:00.000Z'));
    await poller.runCycle(options);
    expect(getStoredPlays()).toHaveLength(1);
    const gamePollId = [...states.keys()][0];
    if (gamePollId === undefined) throw new Error('expected a poll state row');

    // Tick 2: the provider now returns a structurally distinct play (different clock, so the
    // reconciliation key genuinely differs, not just the description) — the stored row from tick 1
    // no longer matches anything, so reconciliation blocks (and nothing is written/deleted).
    fetchMatchDetail.mockReturnValueOnce(
      Promise.resolve({
        detail: rawDetail({
          plays: [rawPlayDetail('a completely different play', { clock: '5:00' })],
        }),
        failureReason: null,
      }),
    );
    setNextPollAt(gameId, new Date('2026-08-23T00:00:00.000Z'));
    setNow(new Date('2026-08-23T00:02:00.000Z'));
    const secondReport = await poller.runCycle(options);
    expect(secondReport.ticks[0]?.plays.blocked).toBe(true);
    expect(states.get(gamePollId)?.playsReviewRequired).toBe(true);
    expect(getStoredPlays()).toHaveLength(1); // still just the original — never deleted

    // Tick 3: the provider reverts to the original snapshot — this is the "later safe snapshot"
    // that resolves the divergence entirely on its own, with no operator repair involved.
    fetchMatchDetail.mockReturnValueOnce(
      Promise.resolve({
        detail: rawDetail({ plays: [rawPlayDetail('original')] }),
        failureReason: null,
      }),
    );
    setNextPollAt(gameId, new Date('2026-08-23T00:02:00.000Z'));
    setNow(new Date('2026-08-23T00:04:00.000Z'));
    const thirdReport = await poller.runCycle(options);
    expect(thirdReport.ticks[0]?.plays.blocked).toBe(false);
    const finalState = states.get(gamePollId);
    expect(finalState?.playsBlockedAt).toBeNull();
    expect(finalState?.playsBlockReason).toBeNull();
    expect(finalState?.playsReviewRequired).toBe(false);
    expect(getStoredPlays()).toHaveLength(1);
  });

  it('still uses normal LIVE reconciliation, not FINAL replacement, for a LIVE tick (regression)', async () => {
    const { poller, options } = harness({ plays: [rawPlayDetail('first play')] });
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.plays.finalReplacementStatus).toBeNull();
    expect(report.ticks[0]?.plays.inserted).toBe(1);
  });

  it('uses authoritative FINAL replacement instead of live reconciliation on first FINAL observation', async () => {
    const { poller, options, getStoredPlays } = harness({
      gameStatus: 'FINAL',
      plays: [rawPlayDetail('final play one'), rawPlayDetail('final play two', { clock: '5:00' })],
    });
    const report = await poller.runCycle(options);
    const tick = report.ticks[0];
    expect(tick?.plays.finalReplacementStatus).toBe('REPLACED');
    expect(tick?.plays.blocked).toBe(false);
    expect(getStoredPlays()).toHaveLength(2);
    expect(getStoredPlays().every((row) => row.id.startsWith('final-generated-'))).toBe(true);
  });

  it('clears a pre-existing durable block once FINAL replacement succeeds', async () => {
    const { poller, options, states, pollStateRepository } = harness({
      gameStatus: 'FINAL',
      plays: [rawPlayDetail('final one')],
    });
    await pollStateRepository.ensurePollStates([gameId], new Date('2026-08-23T00:00:00.000Z'));
    const state = [...states.values()][0];
    if (state === undefined) throw new Error('expected a poll state row');
    state.playsBlockedAt = new Date('2026-08-20T00:00:00Z');
    state.playsBlockReason = 'UNMATCHED_EXISTING';
    state.playsReviewRequired = true;
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.plays.finalReplacementStatus).toBe('REPLACED');
    const after = states.get(state.id);
    expect(after?.playsBlockedAt).toBeNull();
    expect(after?.playsBlockReason).toBeNull();
    expect(after?.playsReviewRequired).toBe(false);
  });

  it('a FINAL validation failure preserves active rows and sets playsReviewRequired via recordSuccess (not recordFailure)', async () => {
    const existingLive: GamePlay[] = [1, 2, 3].map((sequence) => ({
      id: `live-${String(sequence)}`,
      gameId,
      playKey: `live-play-key-${String(sequence)}`,
      reconciliationKey: `live-structural-key-${String(sequence)}`,
      sequence,
      period: 1,
      clock: `${String(10 - sequence)}:00`,
      possessionTeamId: null,
      playType: 'RUSH',
      description: `previously observed live play ${String(sequence)}`,
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
    }));
    const { poller, options, states, getStoredPlays } = harness({
      gameStatus: 'FINAL',
      plays: [rawPlayDetail('only one final play')],
      initiallyStoredPlays: existingLive,
    });
    const report = await poller.runCycle(options);
    const tick = report.ticks[0];
    expect(tick?.plays.finalReplacementStatus).toBe('VALIDATION_FAILED');
    expect(tick?.plays.blocked).toBe(true);
    expect(tick?.plays.blockReason).toBe('FINAL_SNAPSHOT_INVALID');
    expect(tick?.gameState.ok).toBe(true);
    const state = [...states.values()][0];
    expect(state?.playsReviewRequired).toBe(true);
    expect(state?.playsBlockReason).toBe('FINAL_SNAPSHOT_INVALID');
    expect(state?.lastError).toBeNull();
    expect(getStoredPlays()).toEqual(existingLive);
  });

  it('a thrown FINAL replacement error sets FINAL_REPLACEMENT_FAILED via recordFailure', async () => {
    const { poller, options, states, replaceWithAuthoritativeFinalSnapshot, getStoredPlays } =
      harness({
        gameStatus: 'FINAL',
        plays: [rawPlayDetail('final one')],
      });
    replaceWithAuthoritativeFinalSnapshot.mockRejectedValueOnce(new Error('transaction failed'));
    const report = await poller.runCycle(options);
    const tick = report.ticks[0];
    expect(tick?.plays.finalReplacementStatus).toBe('FAILED');
    expect(tick?.plays.ok).toBe(false);
    const state = [...states.values()][0];
    expect(state?.playsBlockReason).toBe('FINAL_REPLACEMENT_FAILED');
    expect(state?.playsReviewRequired).toBe(true);
    expect(state?.lastError).not.toBeNull();
    expect(getStoredPlays()).toEqual([]);
  });

  it('performs immediate reconciliation the first time FINAL is observed and schedules +10', async () => {
    const { poller, options, states } = harness({ gameStatus: 'FINAL' });
    const report = await poller.runCycle(options);
    expect(report.ticks[0]?.schedulingClassBefore).toBe('NOT_DUE');
    expect(report.ticks[0]?.schedulingClassAfter).toBe('FINAL_RECONCILE_10');
    const state = [...states.values()][0];
    expect(state?.finalImmediateCompletedAt).not.toBeNull();
    expect(state?.finalObservedAt).not.toBeNull();
    expect(state?.final10CompletedAt).toBeNull();
  });

  it('advances FINAL_RECONCILE_10 -> FINAL_RECONCILE_60 -> COMPLETE exactly once each', async () => {
    const { poller, options, states, setNextPollAt } = harness({ gameStatus: 'FINAL' });

    await poller.runCycle(options); // immediate
    setNextPollAt(gameId, new Date('2026-08-23T00:00:00.000Z'));
    await poller.runCycle(options); // +10
    let state = [...states.values()][0];
    expect(state?.schedulingClass).toBe('FINAL_RECONCILE_60');
    expect(state?.final10CompletedAt).not.toBeNull();
    expect(state?.final60CompletedAt).toBeNull();

    setNextPollAt(gameId, new Date('2026-08-23T00:00:00.000Z'));
    await poller.runCycle(options); // +60
    state = [...states.values()][0];
    expect(state?.schedulingClass).toBe('COMPLETE');
    expect(state?.final60CompletedAt).not.toBeNull();
    expect(state?.nextPollAt).toBeNull();

    // COMPLETE has no nextPollAt, so a further cycle claims nothing for this game.
    const finalReport = await poller.runCycle(options);
    expect(finalReport.claimed).toBe(0);
  });

  it('degrades gracefully under low rate-limit quota: skips an already-classified normal live game', async () => {
    const { poller, options, states, applySnapshot, setNextPollAt, setRateLimitRemaining } =
      harness({
        plays: [rawPlayDetail('would have been observed')],
      });
    // First cycle at normal quota: classifies the game as LIVE_NORMAL (not brand new anymore).
    const first = await poller.runCycle(options);
    expect(first.ticks[0]?.schedulingClassAfter).toBe('LIVE_NORMAL');
    setNextPollAt(gameId, new Date('2026-08-23T00:00:00.000Z'));
    applySnapshot.mockClear();

    // Second cycle, now under degraded quota: the already-classified LIVE_NORMAL row is
    // claimed but skipped before any provider work.
    setRateLimitRemaining(100); // below the 500 threshold configured in options
    const report = await poller.runCycle(options);
    expect(report.degraded).toBe(true);
    expect(report.claimed).toBe(1);
    expect(report.ticks).toHaveLength(0); // claimed, but skipped before any provider work
    expect(applySnapshot).not.toHaveBeenCalled();
    const state = [...states.values()][0];
    // Released, not stuck, and not penalized onto a longer retry delay than its own schedule.
    expect(state?.lockedAt).toBeNull();
  });

  it('still polls FINAL and featured games while degraded', async () => {
    const { poller, options, states } = harness({
      gameStatus: 'FINAL',
      rateLimitRemaining: 100,
    });
    const report = await poller.runCycle(options);
    expect(report.degraded).toBe(true);
    expect(report.ticks).toHaveLength(1);
    expect(report.ticks[0]?.schedulingClassAfter).toBe('FINAL_RECONCILE_10');
    const state = [...states.values()][0];
    expect(state?.finalImmediateCompletedAt).not.toBeNull();
  });

  it('classifies FINAL_IMMEDIATE/RECONCILE/LIVE_FEATURED as poll-worthy while degraded', () => {
    const asClaim = (schedulingClass: PollStateRow['schedulingClass']): ClaimedPoll => ({
      pollState: {
        id: 'x',
        gameId: 'x',
        schedulingClass,
        featuredReason: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextPollAt: null,
        lastObservedStatus: null,
        lastError: null,
        finalObservedAt: null,
        finalImmediateCompletedAt: null,
        final10CompletedAt: null,
        final60CompletedAt: null,
        playsBlockedAt: null,
        playsBlockReason: null,
        playsReviewRequired: false,
      },
      game: {
        gameId: 'x',
        status: 'IN_PROGRESS',
        startTime: null,
        quarter: null,
        homeScore: null,
        awayScore: null,
        manualFeatured: null,
        broadcastNetwork: null,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        providerMapping: null,
      },
    });
    expect(shouldPollWhileDegraded(asClaim('FINAL_IMMEDIATE'))).toBe(true);
    expect(shouldPollWhileDegraded(asClaim('FINAL_RECONCILE_10'))).toBe(true);
    expect(shouldPollWhileDegraded(asClaim('FINAL_RECONCILE_60'))).toBe(true);
    expect(shouldPollWhileDegraded(asClaim('LIVE_FEATURED'))).toBe(true);
    expect(shouldPollWhileDegraded(asClaim('LIVE_NORMAL'))).toBe(false);
    expect(shouldPollWhileDegraded(asClaim('PREGAME'))).toBe(false);
    expect(shouldPollWhileDegraded(asClaim('HALFTIME'))).toBe(false);
  });
});
