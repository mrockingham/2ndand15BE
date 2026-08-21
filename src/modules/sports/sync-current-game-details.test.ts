import { describe, expect, it, vi } from 'vitest';

import type {
  CurrentGamePlayerStat,
  CurrentGamePlayerStatCoverage,
  CurrentGameTeamStat,
} from '../../generated/prisma/client.js';
import type { CurrentPlayerIdentityProvider } from './current-player-identity-provider.js';
import type {
  CurrentGameDetailsProvider,
  NormalizedCurrentGameDetails,
} from './current-game-details-provider.js';
import type {
  CurrentGameDetailsApplyInput,
  CurrentGameDetailsRepository,
  CurrentGameDetailsTarget,
} from './current-game-details.repository.js';
import { CurrentGameDetailsSyncService } from './sync-current-game-details.js';

const gameId = '0768c441-16a6-457c-b50f-e7273d750d77';
const targetBase: CurrentGameDetailsTarget = {
  id: gameId,
  homeTeamId: '8d07dd7a-c2d5-410d-bffc-5c013f88420d',
  awayTeamId: '38c0acd1-35e3-429d-81cf-e37db8bbaf9c',
  homeAbbreviation: 'ARI',
  awayAbbreviation: 'CAR',
  providerMapping: { providerGameId: '565788' },
  teamStats: [],
  playerStats: [],
  playerCoverage: null,
};

const emptyTeamStats = {
  firstDowns: 0,
  firstDownsPassing: null,
  firstDownsRushing: null,
  firstDownsPenalty: null,
  totalPlays: 0,
  totalYards: 0,
  passingCompletions: 0,
  passingAttempts: 0,
  passingYards: 0,
  passingInterceptions: 0,
  rushingAttempts: 0,
  rushingYards: 0,
  turnovers: 0,
  fumblesLost: 0,
  sacks: 0,
  sackYardsLost: 0,
  thirdDownConversions: 0,
  thirdDownAttempts: 0,
  fourthDownConversions: 0,
  fourthDownAttempts: 0,
  penalties: 0,
  penaltyYards: 0,
  possessionSeconds: 0,
  redZoneConversions: 0,
  redZoneAttempts: 0,
  totalDrives: 0,
};

const detail: NormalizedCurrentGameDetails = {
  provider: 'highlightly',
  providerGameId: '565788',
  homeProviderTeamId: 'ari-provider',
  awayProviderTeamId: 'car-provider',
  homeAbbreviation: 'ARI',
  awayAbbreviation: 'CAR',
  homeTeamStats: { ...emptyTeamStats, totalYards: 425 },
  awayTeamStats: { ...emptyTeamStats, totalYards: 378, turnovers: 1 },
  homePeriodScores: {
    period1: 0,
    period2: 17,
    period3: 3,
    period4: 10,
    overtime1: null,
    overtime2: null,
  },
  awayPeriodScores: {
    period1: 0,
    period2: 17,
    period3: 0,
    period4: 16,
    overtime1: null,
    overtime2: null,
  },
  playerStats: [player('player-1', 'ari-provider'), player('player-2', 'car-provider')],
  scoringEventCount: 12,
  playCount: 183,
  structuredPlayCount: 0,
};

const policy = {
  nodeEnv: 'development' as const,
  evaluationMode: true,
  publicationApproved: false,
};

function harness() {
  let rows: CurrentGameTeamStat[] = [];
  const applyStats = vi.fn((input: CurrentGameDetailsApplyInput) => {
    for (const row of input.rows) {
      const persisted: CurrentGameTeamStat = {
        id: `stat-${row.isHome ? 'home' : 'away'}`,
        ...row,
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
        updatedAt: row.sourceUpdatedAt,
      };
      rows = [...rows.filter((existing) => existing.teamId !== row.teamId), persisted];
    }
    return Promise.resolve();
  });
  const findPlayerMappings = vi.fn(() =>
    Promise.resolve<ReadonlyMap<string, string>>(new Map([['player-1', 'internal-player-1']])),
  );
  const repository: CurrentGameDetailsRepository = {
    findTarget: vi.fn(() => Promise.resolve({ ...targetBase, teamStats: rows })),
    findPlayerMappings,
    applyStats,
  };
  const getGameDetails = vi.fn<CurrentGameDetailsProvider['getGameDetails']>(() =>
    Promise.resolve({
      provider: 'highlightly',
      record: detail,
      failures: [],
      requestsUsed: 2,
      responseDurationMs: 100,
    }),
  );
  const provider: CurrentGameDetailsProvider = { providerKey: 'highlightly', getGameDetails };
  return {
    service: new CurrentGameDetailsSyncService(
      provider,
      repository,
      () => new Date('2026-08-08T12:00:00.000Z'),
    ),
    applyStats,
    findPlayerMappings,
    getGameDetails,
  };
}

describe('CurrentGameDetailsSyncService', () => {
  it('dry-runs two creates, batch-resolves player identity, and performs no mutation', async () => {
    const test = harness();
    const report = await test.service.sync({ gameId, apply: false, policy });
    expect(report).toMatchObject({
      dryRun: true,
      requestsUsed: 2,
      teamStats: { wouldCreate: 2, created: 0, updated: 0, unchanged: 0 },
      playerStats: { received: 2, matched: 1, unmatched: 1, ambiguous: 0, persisted: 0 },
      discovery: { scoringEvents: 12, plays: 183, structuredPlays: 0 },
    });
    expect(report.results.map((result) => result.outcome)).toEqual([
      'WOULD_CREATE',
      'WOULD_CREATE',
    ]);
    expect(test.findPlayerMappings).toHaveBeenCalledOnce();
    expect(test.applyStats).not.toHaveBeenCalled();
  });

  it('applies once and leaves both unique team rows unchanged on repeat', async () => {
    const test = harness();
    await expect(test.service.sync({ gameId, apply: true, policy })).resolves.toMatchObject({
      teamStats: { created: 2, unchanged: 0 },
    });
    await expect(test.service.sync({ gameId, apply: true, policy })).resolves.toMatchObject({
      teamStats: { created: 0, updated: 0, unchanged: 2 },
    });
    expect(test.applyStats).toHaveBeenCalledOnce();
    expect(test.applyStats.mock.calls[0]?.[0].rows).toHaveLength(2);
  });

  it('supports team-stat-only enrichment without reading or writing player data', async () => {
    const test = harness();
    await expect(
      test.service.sync({
        gameId,
        providerGameId: '565788',
        includePlayerStats: false,
        apply: true,
        policy,
      }),
    ).resolves.toMatchObject({
      teamStats: { created: 2 },
      playerStats: { received: 0, persisted: 0, reason: null },
    });
    expect(test.getGameDetails).toHaveBeenCalledWith('565788', { includePlayerStats: false });
    expect(test.findPlayerMappings).not.toHaveBeenCalled();
  });

  it('rejects provider orientation mismatches without writing', async () => {
    const test = harness();
    test.getGameDetails.mockResolvedValueOnce({
      provider: 'highlightly',
      record: { ...detail, homeAbbreviation: 'CAR', awayAbbreviation: 'ARI' },
      failures: [],
      requestsUsed: 2,
      responseDurationMs: 100,
    });
    await expect(test.service.sync({ gameId, apply: true, policy })).rejects.toMatchObject({
      code: 'CURRENT_GAME_DETAILS_IDENTITY_MISMATCH',
    });
    expect(test.applyStats).not.toHaveBeenCalled();
  });

  it('reports conflicting duplicate provider player identities as ambiguous', async () => {
    const test = harness();
    test.getGameDetails.mockResolvedValueOnce({
      provider: 'highlightly',
      record: {
        ...detail,
        playerStats: [
          player('duplicate-player', 'ari-provider'),
          { ...player('duplicate-player', 'car-provider'), displayName: 'Different Player' },
        ],
      },
      failures: [],
      requestsUsed: 2,
      responseDurationMs: 100,
    });
    await expect(test.service.sync({ gameId, apply: false, policy })).resolves.toMatchObject({
      playerStats: { received: 2, matched: 0, unmatched: 0, ambiguous: 1, persisted: 0 },
    });
  });

  it('preserves the M22 production publication guard', async () => {
    const test = harness();
    await expect(
      test.service.sync({
        gameId,
        apply: true,
        policy: { nodeEnv: 'production', evaluationMode: true, publicationApproved: false },
      }),
    ).rejects.toMatchObject({ code: 'HIGHLIGHTLY_PUBLICATION_NOT_APPROVED' });
    expect(test.getGameDetails).not.toHaveBeenCalled();
  });

  it('reconciles an unmapped profile, persists rows once, and skips profile HTTP on repeat', async () => {
    const mappings = new Map([['player-1', 'internal-player-1']]);
    let persistedRows: CurrentGamePlayerStat[] = [];
    let coverage: CurrentGamePlayerStatCoverage | null = null;
    const applyPlayerStats = vi.fn<NonNullable<CurrentGameDetailsRepository['applyPlayerStats']>>(
      (input) => {
        for (const plan of input.plans) {
          const playerId = plan.playerId ?? 'new-player';
          if (plan.createMapping) mappings.set(plan.providerPlayerId, playerId);
          persistedRows = [
            ...persistedRows.filter((row) => row.playerId !== playerId),
            {
              id: `row-${playerId}`,
              gameId,
              teamId: plan.teamId,
              playerId,
              ...plan.values,
              sourceProvider: input.provider,
              sourceUpdatedAt: input.sourceUpdatedAt,
              createdAt: input.sourceUpdatedAt,
              updatedAt: input.sourceUpdatedAt,
            },
          ];
        }
        coverage = {
          id: 'coverage',
          gameId,
          providerRows: input.providerPlayerCount,
          resolvedRows: input.resolvedPlayerCount,
          unresolvedRows: input.unresolvedPlayerCount,
          sourceProvider: input.provider,
          sourceUpdatedAt: input.sourceUpdatedAt,
          createdAt: input.sourceUpdatedAt,
          updatedAt: input.sourceUpdatedAt,
        };
        return Promise.resolve();
      },
    );
    const repository: CurrentGameDetailsRepository = {
      findTarget: () =>
        Promise.resolve({
          ...targetBase,
          teamStats: [],
          playerStats: persistedRows,
          playerCoverage: coverage,
        }),
      findPlayerMappings: (_provider, ids) => {
        const resolved = ids.flatMap((id) => {
          const playerId = mappings.get(id);
          return playerId === undefined ? [] : [[id, playerId] as const];
        });
        return Promise.resolve(new Map(resolved));
      },
      findPlayerMappingOwners: () => Promise.resolve(new Map()),
      findPlayerIdentityCandidates: () => Promise.resolve([identityCandidate()]),
      applyStats: () => Promise.resolve(),
      applyPlayerStats,
    };
    const detailsProvider: CurrentGameDetailsProvider = {
      providerKey: 'highlightly',
      getGameDetails: () =>
        Promise.resolve({
          provider: 'highlightly',
          record: detail,
          failures: [],
          requestsUsed: 2,
          responseDurationMs: 10,
        }),
    };
    const getPlayerProfiles = vi.fn<CurrentPlayerIdentityProvider['getPlayerProfiles']>((ids) =>
      Promise.resolve({
        provider: 'highlightly',
        profiles: ids.map(() => currentProfile()),
        failures: [],
        requestsUsed: ids.length,
        responseDurationMs: 5,
      }),
    );
    const service = new CurrentGameDetailsSyncService(
      detailsProvider,
      repository,
      () => new Date('2026-08-09T12:00:00.000Z'),
      { providerKey: 'highlightly', getPlayerProfiles },
    );

    await expect(service.sync({ gameId, apply: false, policy })).resolves.toMatchObject({
      playerStats: {
        resolutionMethods: { EXISTING_MAPPING: 1, STRONG_PROFILE: 1 },
        profiles: { requested: 1, returned: 1, requestsUsed: 1 },
        mappings: { wouldCreate: 1 },
        rows: { wouldCreate: 2 },
      },
    });
    expect(applyPlayerStats).not.toHaveBeenCalled();

    await service.sync({ gameId, apply: true, policy });
    await expect(service.sync({ gameId, apply: true, policy })).resolves.toMatchObject({
      playerStats: {
        resolutionMethods: { EXISTING_MAPPING: 2 },
        profiles: { requested: 0, requestsUsed: 0 },
        rows: { unchanged: 2 },
      },
    });
    expect(applyPlayerStats).toHaveBeenCalledOnce();
    expect(getPlayerProfiles.mock.calls.at(-1)?.[0]).toEqual([]);
  });
});

function currentProfile() {
  return {
    providerPlayerId: 'player-2',
    displayName: 'Example Player',
    birthDate: '2000-01-01',
    position: 'RB',
    sourcePosition: 'Running Back',
    jerseyNumber: 22,
    teamProviderId: 'car-provider',
    teamAbbreviation: 'CAR',
    heightInches: 72,
    weightPounds: 210,
    draftYear: 2022,
    draftRound: 2,
    draftPick: 50,
    isActive: true,
  } as const;
}

function identityCandidate() {
  return {
    id: 'internal-player-2',
    displayName: 'Example Player',
    normalizedName: 'example player',
    birthDate: '2000-01-01',
    position: 'RB',
    jerseyNumber: 22,
    heightInches: 72,
    weightPounds: 210,
    draftYear: 2022,
    draftRound: 2,
    draftPick: 50,
    latestTeamId: targetBase.awayTeamId,
    rosterTeamIds: [targetBase.awayTeamId],
  };
}

function player(providerPlayerId: string, teamProviderId: string) {
  return {
    providerPlayerId,
    teamProviderId,
    displayName: 'Example Player',
    passingCompletions: null,
    passingAttempts: null,
    passingYards: null,
    passingTouchdowns: null,
    passingInterceptions: null,
    sacksSuffered: null,
    sackYardsLost: null,
    rushingAttempts: null,
    rushingYards: null,
    rushingTouchdowns: null,
    longestRush: null,
    targets: null,
    receptions: null,
    receivingYards: null,
    receivingTouchdowns: null,
    longestReception: null,
    fumbles: null,
    fumbleRecoveries: null,
    tacklesTotal: null,
    tacklesSolo: null,
    defensiveSacks: null,
    tacklesForLoss: null,
    passesDefended: null,
    defensiveTouchdowns: null,
    fieldGoalsMade: null,
    fieldGoalsAttempted: null,
    longestFieldGoal: null,
    extraPointsMade: null,
    extraPointsAttempted: null,
    punts: null,
    puntYards: null,
    puntAverage: null,
    puntsInside20: null,
    puntTouchbacks: null,
    longestPunt: null,
    kickReturns: null,
    kickReturnYards: null,
    kickReturnTouchdowns: null,
    longestKickReturn: null,
    puntReturns: null,
    puntReturnYards: null,
    puntReturnTouchdowns: null,
    longestPuntReturn: null,
  };
}
