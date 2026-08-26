import { describe, expect, it } from 'vitest';

import {
  classifyPlayerStatsCoverage,
  classifyPlayerStatsProbe,
  classifyPlaysCoverage,
  classifyPlaysProbe,
  classifyResultCoverage,
  classifyResultProbe,
  classifyTeamStatsCoverage,
  classifyTeamStatsProbe,
} from './data-health-diagnosis.js';

const homeTeamId = 'home-team';
const awayTeamId = 'away-team';

function teamStatRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    gameId: 'game-1',
    teamId: homeTeamId,
    isHome: true,
    firstDowns: 20,
    firstDownsPassing: 12,
    firstDownsRushing: 6,
    firstDownsPenalty: 2,
    totalPlays: 60,
    totalYards: 350,
    passingCompletions: 22,
    passingAttempts: 32,
    passingYards: 220,
    passingInterceptions: 1,
    rushingAttempts: 28,
    rushingYards: 130,
    turnovers: 1,
    fumblesLost: 0,
    sacks: 2,
    sackYardsLost: 14,
    thirdDownConversions: 5,
    thirdDownAttempts: 12,
    fourthDownConversions: 0,
    fourthDownAttempts: 1,
    penalties: 4,
    penaltyYards: 35,
    possessionSeconds: 1800,
    redZoneConversions: 2,
    redZoneAttempts: 3,
    totalDrives: 11,
    period1Score: 7,
    period2Score: 7,
    period3Score: 0,
    period4Score: 3,
    overtime1Score: null,
    overtime2Score: null,
    sourceProvider: 'highlightly',
    sourceUpdatedAt: new Date(),
    ...overrides,
  };
}

describe('classifyResultCoverage', () => {
  it('reports PENDING for a scheduled game with no score', () => {
    const result = classifyResultCoverage({
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      hasProviderMapping: false,
      hasEditorialFallback: false,
    });
    expect(result).toEqual({ state: 'PENDING', reasonCode: 'RESULT_PENDING' });
  });

  it('reports COMPLETE for a final game with a score', () => {
    const result = classifyResultCoverage({
      status: 'FINAL',
      homeScore: 24,
      awayScore: 17,
      hasProviderMapping: true,
      hasEditorialFallback: false,
    });
    expect(result).toEqual({ state: 'COMPLETE', reasonCode: 'RESULT_COMPLETE' });
  });

  it('reports MISSING_PROVIDER_MAPPING for a final game missing a score and a mapping', () => {
    const result = classifyResultCoverage({
      status: 'FINAL',
      homeScore: null,
      awayScore: null,
      hasProviderMapping: false,
      hasEditorialFallback: false,
    });
    expect(result).toEqual({ state: 'MISSING', reasonCode: 'MISSING_PROVIDER_MAPPING' });
  });

  it('reports PROBE_REQUIRED for a final game with a mapping but no score yet', () => {
    const result = classifyResultCoverage({
      status: 'FINAL',
      homeScore: null,
      awayScore: null,
      hasProviderMapping: true,
      hasEditorialFallback: false,
    });
    expect(result).toEqual({ state: 'MISSING', reasonCode: 'PROBE_REQUIRED' });
  });

  it('prefers the editorial fallback over provider state', () => {
    const result = classifyResultCoverage({
      status: 'IN_PROGRESS',
      homeScore: null,
      awayScore: null,
      hasProviderMapping: true,
      hasEditorialFallback: true,
    });
    expect(result).toEqual({ state: 'COMPLETE', reasonCode: 'RESULT_USING_EDITORIAL_FALLBACK' });
  });
});

describe('classifyTeamStatsCoverage', () => {
  it('reports COMPLETE for two oriented, core-complete rows', () => {
    const result = classifyTeamStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rows: [
        teamStatRow({ teamId: homeTeamId, isHome: true }),
        teamStatRow({ teamId: awayTeamId, isHome: false }),
      ],
      homeTeamId,
      awayTeamId,
    });
    expect(result.state).toBe('COMPLETE');
    expect(result.reasonCode).toBe('TEAM_STATS_COMPLETE');
    expect(result.rowCount).toBe(2);
  });

  it('reports MISSING with PROBE_REQUIRED for a final game with no rows and a mapping', () => {
    const result = classifyTeamStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rows: [],
      homeTeamId,
      awayTeamId,
    });
    expect(result.state).toBe('MISSING');
    expect(result.reasonCode).toBe('PROBE_REQUIRED');
  });

  it('reports PENDING for a scheduled game with no rows', () => {
    const result = classifyTeamStatsCoverage({
      status: 'SCHEDULED',
      hasProviderMapping: true,
      rows: [],
      homeTeamId,
      awayTeamId,
    });
    expect(result.state).toBe('PENDING');
    expect(result.reasonCode).toBe('NOT_EXPECTED_YET');
  });

  it('reports MISSING_PROVIDER_MAPPING when there is no mapping', () => {
    const result = classifyTeamStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: false,
      rows: [],
      homeTeamId,
      awayTeamId,
    });
    expect(result.reasonCode).toBe('MISSING_PROVIDER_MAPPING');
  });
});

describe('classifyPlayerStatsCoverage', () => {
  it('reports COMPLETE when rows exist and coverage has no unresolved rows', () => {
    const result = classifyPlayerStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rowCount: 25,
      coverage: { providerRows: 25, resolvedRows: 25, unresolvedRows: 0 },
    });
    expect(result).toEqual({
      state: 'COMPLETE',
      reasonCode: 'PLAYER_STATS_COMPLETE',
      rowCount: 25,
      playerCount: 25,
    });
  });

  it('reports PARTIAL when coverage shows unresolved rows alongside stored rows', () => {
    const result = classifyPlayerStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rowCount: 20,
      coverage: { providerRows: 25, resolvedRows: 20, unresolvedRows: 5 },
    });
    expect(result.state).toBe('PARTIAL');
    expect(result.reasonCode).toBe('PLAYER_IDENTITY_UNRESOLVED');
  });

  it('reports MISSING with no rows and no prior coverage on a final game', () => {
    const result = classifyPlayerStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rowCount: 0,
      coverage: null,
    });
    expect(result.state).toBe('MISSING');
    expect(result.reasonCode).toBe('PROBE_REQUIRED');
  });

  it('reports UNAVAILABLE when a prior sync recorded zero provider rows', () => {
    const result = classifyPlayerStatsCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      rowCount: 0,
      coverage: { providerRows: 0, resolvedRows: 0, unresolvedRows: 0 },
    });
    expect(result.reasonCode).toBe('PROVIDER_NO_PLAYER_STATS');
  });
});

describe('classifyPlaysCoverage', () => {
  it('reports COMPLETE for a final game with active plays', () => {
    const result = classifyPlaysCoverage({
      status: 'FINAL',
      hasProviderMapping: true,
      activeCount: 150,
      reviewRequired: false,
    });
    expect(result.state).toBe('COMPLETE');
    expect(result.reasonCode).toBe('PLAYS_COMPLETE');
  });

  it('reports PARTIAL with PLAYS_REVIEW_REQUIRED when review is blocked', () => {
    const result = classifyPlaysCoverage({
      status: 'IN_PROGRESS',
      hasProviderMapping: true,
      activeCount: 40,
      reviewRequired: true,
    });
    expect(result.state).toBe('PARTIAL');
    expect(result.reasonCode).toBe('PLAYS_REVIEW_REQUIRED');
    expect(result.reviewRequired).toBe(true);
  });

  it('reports PENDING for a scheduled game with no plays', () => {
    const result = classifyPlaysCoverage({
      status: 'SCHEDULED',
      hasProviderMapping: true,
      activeCount: 0,
      reviewRequired: false,
    });
    expect(result.state).toBe('PENDING');
    expect(result.reasonCode).toBe('PLAYS_PENDING');
  });

  it('reports MISSING_PROVIDER_MAPPING when there is no mapping', () => {
    const result = classifyPlaysCoverage({
      status: 'FINAL',
      hasProviderMapping: false,
      activeCount: 0,
      reviewRequired: false,
    });
    expect(result.reasonCode).toBe('MISSING_PROVIDER_MAPPING');
  });
});

describe('probe-time classifiers (require real provider data)', () => {
  it('classifyResultProbe reports RESULT_CONFLICT when provider disagrees with an editorial fallback', () => {
    const code = classifyResultProbe({
      hasProviderMapping: true,
      hasEditorialFallback: true,
      dbStatus: 'FINAL',
      dbHomeScore: 24,
      dbAwayScore: 17,
      providerStatus: 'FINAL',
      providerHomeScore: 21,
      providerAwayScore: 17,
    });
    expect(code).toBe('RESULT_CONFLICT');
  });

  it('classifyTeamStatsProbe reports PROVIDER_HAS_TEAM_STATS_DB_MISSING', () => {
    const code = classifyTeamStatsProbe({
      hasProviderMapping: true,
      notExpectedYet: false,
      providerRowCount: 2,
      dbRowCount: 0,
      dbComplete: false,
    });
    expect(code).toBe('PROVIDER_HAS_TEAM_STATS_DB_MISSING');
  });

  it('classifyPlayerStatsProbe reports PROVIDER_HAS_PLAYER_STATS_DB_MISSING when identities resolve but nothing is stored', () => {
    const code = classifyPlayerStatsProbe({
      hasProviderMapping: true,
      notExpectedYet: false,
      providerRawRowCount: 26,
      resolvedPlayerCount: 24,
      unresolvedPlayerCount: 2,
      dbRowCount: 0,
    });
    expect(code).toBe('PLAYER_IDENTITY_UNRESOLVED');
  });

  it('classifyPlayerStatsProbe reports PROVIDER_NO_PLAYER_STATS when the provider has nothing', () => {
    const code = classifyPlayerStatsProbe({
      hasProviderMapping: true,
      notExpectedYet: false,
      providerRawRowCount: 0,
      resolvedPlayerCount: 0,
      unresolvedPlayerCount: 0,
      dbRowCount: 0,
    });
    expect(code).toBe('PROVIDER_NO_PLAYER_STATS');
  });

  it('classifyPlayerStatsProbe reports PLAYER_STATS_COMPLETE when DB coverage matches resolved players', () => {
    const code = classifyPlayerStatsProbe({
      hasProviderMapping: true,
      notExpectedYet: false,
      providerRawRowCount: 25,
      resolvedPlayerCount: 25,
      unresolvedPlayerCount: 0,
      dbRowCount: 25,
    });
    expect(code).toBe('PLAYER_STATS_COMPLETE');
  });

  it('classifyPlaysProbe reports PLAYS_PARTIAL when the database trails the provider', () => {
    const code = classifyPlaysProbe({
      hasProviderMapping: true,
      notExpectedYet: false,
      reviewRequired: false,
      providerPlayCount: 150,
      dbPlayCount: 90,
    });
    expect(code).toBe('PLAYS_PARTIAL');
  });
});
