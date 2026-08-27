import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type {
  CurrentGameDetailsApplyInput,
  CurrentGamePlayerApplyInput,
  CurrentGamePlayerStatValues,
} from './current-game-details.repository.js';
import { PrismaCurrentGameDetailsRepository } from './current-game-details.repository.js';

const input = {
  target: {
    id: '0768c441-16a6-457c-b50f-e7273d750d77',
    homeTeamId: 'home-team',
    awayTeamId: 'away-team',
    homeAbbreviation: 'ARI',
    awayAbbreviation: 'CAR',
    providerMapping: { providerGameId: '565788' },
    teamStats: [],
    playerStats: [],
    playerCoverage: null,
  },
  rows: [row(true, 'home-team'), row(false, 'away-team')],
  provider: 'highlightly',
  usageMode: 'evaluation',
  unmatchedPlayerCount: 82,
} satisfies CurrentGameDetailsApplyInput;

function harness(secondUpsertError?: Error) {
  const upsert = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockImplementationOnce(() =>
      secondUpsertError === undefined ? Promise.resolve({}) : Promise.reject(secondUpsertError),
    );
  const auditCreate = vi.fn().mockResolvedValue({});
  const transaction = { currentGameTeamStat: { upsert }, adminAuditEvent: { create: auditCreate } };
  const runTransaction = vi.fn((callback: (value: typeof transaction) => Promise<void>) =>
    callback(transaction),
  );
  return {
    repository: new PrismaCurrentGameDetailsRepository({
      $transaction: runTransaction,
    } as unknown as PrismaClient),
    upsert,
    auditCreate,
    runTransaction,
  };
}

describe('PrismaCurrentGameDetailsRepository', () => {
  it('upserts both unique game/team rows and a private audit in one transaction', async () => {
    const test = harness();
    await expect(test.repository.applyStats(input)).resolves.toBeUndefined();
    expect(test.runTransaction).toHaveBeenCalledOnce();
    expect(test.upsert).toHaveBeenCalledTimes(2);
    expect(test.auditCreate).toHaveBeenCalledOnce();
  });

  it('propagates a related-row failure so the transaction rolls back before audit', async () => {
    const test = harness(new Error('second row failed'));
    await expect(test.repository.applyStats(input)).rejects.toThrow('second row failed');
    expect(test.auditCreate).not.toHaveBeenCalled();
  });

  it('creates a current player, private mapping, stat row, coverage, and audit transactionally', async () => {
    const playerCreate = vi.fn().mockResolvedValue({ id: 'new-player' });
    const mappingCreate = vi.fn().mockResolvedValue({});
    const statUpsert = vi.fn().mockResolvedValue({});
    const coverageUpsert = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      player: { create: playerCreate },
      playerExternalIdentifier: { create: mappingCreate },
      currentGamePlayerStat: { upsert: statUpsert },
      currentGamePlayerStatCoverage: { upsert: coverageUpsert },
      adminAuditEvent: { create: auditCreate },
    };
    const repository = new PrismaCurrentGameDetailsRepository({
      $transaction: (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
    } as unknown as PrismaClient);
    await repository.applyPlayerStats(playerApplyInput());
    expect(playerCreate).toHaveBeenCalledOnce();
    expect(mappingCreate).toHaveBeenCalledOnce();
    const mappingCall: unknown = mappingCreate.mock.calls[0]?.[0];
    expect(mappingCall).toEqual({
      data: {
        playerId: 'new-player',
        provider: 'highlightly',
        externalId: 'provider-player',
        source: 'current-game-player-profile',
      },
    });
    expect(statUpsert).toHaveBeenCalledOnce();
    expect(coverageUpsert).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('propagates player-stat failure before coverage or audit so the transaction rolls back', async () => {
    const statUpsert = vi.fn().mockRejectedValue(new Error('stat failed'));
    const coverageUpsert = vi.fn();
    const auditCreate = vi.fn();
    const transaction = {
      player: { create: vi.fn().mockResolvedValue({ id: 'new-player' }) },
      playerExternalIdentifier: { create: vi.fn().mockResolvedValue({}) },
      currentGamePlayerStat: { upsert: statUpsert },
      currentGamePlayerStatCoverage: { upsert: coverageUpsert },
      adminAuditEvent: { create: auditCreate },
    };
    const repository = new PrismaCurrentGameDetailsRepository({
      $transaction: (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
    } as unknown as PrismaClient);
    await expect(repository.applyPlayerStats(playerApplyInput())).rejects.toThrow('stat failed');
    expect(coverageUpsert).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

function playerApplyInput(): CurrentGamePlayerApplyInput {
  return {
    target: input.target,
    plans: [
      {
        providerPlayerId: 'provider-player',
        playerId: null,
        teamId: 'home-team',
        profile: {
          providerPlayerId: 'provider-player',
          displayName: 'New Player',
          birthDate: '2003-01-02',
          position: 'WR',
          sourcePosition: 'Wide Receiver',
          jerseyNumber: 11,
          teamProviderId: 'provider-team',
          teamAbbreviation: 'ARI',
          heightInches: 73,
          weightPounds: 195,
          draftYear: 2026,
          draftRound: null,
          draftPick: null,
          isActive: true,
        },
        createMapping: true,
        values: emptyPlayerValues(),
        changed: true,
      },
    ],
    provider: 'highlightly',
    usageMode: 'evaluation',
    sourceUpdatedAt: new Date('2026-08-09T12:00:00.000Z'),
    unresolvedPlayerCount: 0,
    providerPlayerCount: 1,
    resolvedPlayerCount: 1,
    coverageChanged: true,
  };
}

function emptyPlayerValues(): CurrentGamePlayerStatValues {
  return {
    passingCompletions: 0,
    passingAttempts: 0,
    passingYards: 0,
    passingTouchdowns: 0,
    passingInterceptions: 0,
    sacksSuffered: 0,
    sackYardsLost: 0,
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

function row(isHome: boolean, teamId: string) {
  return {
    gameId: '0768c441-16a6-457c-b50f-e7273d750d77',
    teamId,
    isHome,
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
    period1Score: 0,
    period2Score: 0,
    period3Score: 0,
    period4Score: 0,
    overtime1Score: null,
    overtime2Score: null,
    sourceProvider: 'highlightly',
    sourceUpdatedAt: new Date('2026-08-08T12:00:00.000Z'),
  };
}
