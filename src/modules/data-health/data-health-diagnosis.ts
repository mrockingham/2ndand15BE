import type { GameStatus } from '../../generated/prisma/client.js';
import type { CurrentGameTeamStatWrite } from '../sports/current-game-details.repository.js';
import { classifyCurrentGameTeamStats } from '../sports/current-game-team-stat-coverage.js';

/**
 * What OUR DATABASE currently holds, independent of whether the provider was ever asked.
 * Kept deliberately separate from the diagnosis codes below, which describe *why*.
 */
export type DataHealthCoverageState =
  'COMPLETE' | 'PARTIAL' | 'MISSING' | 'PENDING' | 'UNAVAILABLE' | 'UNKNOWN';

/**
 * `PROBE_REQUIRED` is not part of the brief's vocabulary -- it is the deliberate DB-only
 * sentinel documented in docs/administration/data-health.md: the DB alone cannot distinguish
 * "provider never had it" from "provider has it and we failed to ingest it" from "provider
 * request would fail." Only an explicit probe can resolve it into one of the other codes.
 */
export type ResultDiagnosisCode =
  | 'RESULT_COMPLETE'
  | 'RESULT_PENDING'
  | 'PROVIDER_RESULT_MISSING'
  | 'RESULT_USING_EDITORIAL_FALLBACK'
  | 'RESULT_CONFLICT'
  | 'PROVIDER_HAS_RESULT_DB_MISSING'
  | 'PROVIDER_REQUEST_FAILED'
  | 'MISSING_PROVIDER_MAPPING'
  | 'PROBE_REQUIRED';

export type TeamStatsDiagnosisCode =
  | 'NOT_EXPECTED_YET'
  | 'MISSING_PROVIDER_MAPPING'
  | 'PROVIDER_NO_TEAM_STATS'
  | 'PROVIDER_HAS_TEAM_STATS_DB_MISSING'
  | 'DB_TEAM_STATS_PARTIAL'
  | 'TEAM_STATS_COMPLETE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROBE_REQUIRED';

export type PlayerStatsDiagnosisCode =
  | 'NOT_EXPECTED_YET'
  | 'MISSING_PROVIDER_MAPPING'
  | 'PROVIDER_NO_PLAYER_STATS'
  | 'PROVIDER_HAS_PLAYER_STATS_DB_MISSING'
  | 'PLAYER_IDENTITY_UNRESOLVED'
  | 'DB_PLAYER_STATS_PARTIAL'
  | 'PLAYER_STATS_COMPLETE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROBE_REQUIRED';

export type PlaysDiagnosisCode =
  | 'PLAYS_PENDING'
  | 'MISSING_PROVIDER_MAPPING'
  | 'PROVIDER_NO_PLAYS'
  | 'PROVIDER_HAS_PLAYS_DB_MISSING'
  | 'PLAYS_PARTIAL'
  | 'PLAYS_COMPLETE'
  | 'PLAYS_REVIEW_REQUIRED'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROBE_REQUIRED';

const PRE_GAME_STATUSES: readonly GameStatus[] = ['SCHEDULED', 'PREGAME'];
const UNAVAILABLE_STATUSES: readonly GameStatus[] = ['POSTPONED', 'CANCELED', 'SUSPENDED'];
const STATS_EXPECTED_STATUSES: readonly GameStatus[] = ['IN_PROGRESS', 'HALFTIME', 'FINAL'];

export function isStatsExpected(status: GameStatus): boolean {
  return STATS_EXPECTED_STATUSES.includes(status);
}

interface DbOnlyContext {
  readonly status: GameStatus;
  readonly hasProviderMapping: boolean;
}

function dbOnlyEmptyState(context: DbOnlyContext): DataHealthCoverageState {
  if (PRE_GAME_STATUSES.includes(context.status)) return 'PENDING';
  if (UNAVAILABLE_STATUSES.includes(context.status)) return 'UNAVAILABLE';
  return 'MISSING';
}

// ---------------------------------------------------------------------------
// Result coverage (DB-only)
// ---------------------------------------------------------------------------

export interface ResultCoverage {
  readonly state: DataHealthCoverageState;
  readonly reasonCode: ResultDiagnosisCode;
}

export function classifyResultCoverage(input: {
  readonly status: GameStatus;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly hasProviderMapping: boolean;
  readonly hasEditorialFallback: boolean;
}): ResultCoverage {
  if (input.hasEditorialFallback) {
    return { state: 'COMPLETE', reasonCode: 'RESULT_USING_EDITORIAL_FALLBACK' };
  }
  if (PRE_GAME_STATUSES.includes(input.status)) {
    return { state: 'PENDING', reasonCode: 'RESULT_PENDING' };
  }
  if (UNAVAILABLE_STATUSES.includes(input.status)) {
    return { state: 'UNAVAILABLE', reasonCode: 'RESULT_PENDING' };
  }
  const hasScore = input.homeScore !== null && input.awayScore !== null;
  if (input.status === 'FINAL') {
    if (hasScore) return { state: 'COMPLETE', reasonCode: 'RESULT_COMPLETE' };
    if (!input.hasProviderMapping) {
      return { state: 'MISSING', reasonCode: 'MISSING_PROVIDER_MAPPING' };
    }
    return { state: 'MISSING', reasonCode: 'PROBE_REQUIRED' };
  }
  // IN_PROGRESS / HALFTIME
  return { state: hasScore ? 'PARTIAL' : 'PENDING', reasonCode: 'RESULT_PENDING' };
}

// ---------------------------------------------------------------------------
// Team-stat coverage (DB-only) -- reuses the real classifier for the rows>0 case.
// ---------------------------------------------------------------------------

export interface TeamStatsCoverage {
  readonly state: DataHealthCoverageState;
  readonly reasonCode: TeamStatsDiagnosisCode;
  readonly rowCount: number;
  readonly expectedRowCount: 2;
}

export function classifyTeamStatsCoverage(input: {
  readonly status: GameStatus;
  readonly hasProviderMapping: boolean;
  readonly rows: readonly CurrentGameTeamStatWrite[];
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}): TeamStatsCoverage {
  if (input.rows.length === 0) {
    if (!input.hasProviderMapping) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'MISSING_PROVIDER_MAPPING',
        rowCount: 0,
        expectedRowCount: 2,
      };
    }
    if (!isStatsExpected(input.status)) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'NOT_EXPECTED_YET',
        rowCount: 0,
        expectedRowCount: 2,
      };
    }
    return { state: 'MISSING', reasonCode: 'PROBE_REQUIRED', rowCount: 0, expectedRowCount: 2 };
  }
  const classification = classifyCurrentGameTeamStats({
    rows: input.rows,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
  });
  return {
    state: classification.classification,
    reasonCode:
      classification.classification === 'COMPLETE'
        ? 'TEAM_STATS_COMPLETE'
        : 'DB_TEAM_STATS_PARTIAL',
    rowCount: input.rows.length,
    expectedRowCount: 2,
  };
}

// ---------------------------------------------------------------------------
// Player-stat coverage (DB-only)
// ---------------------------------------------------------------------------

export interface PlayerStatsCoverage {
  readonly state: DataHealthCoverageState;
  readonly reasonCode: PlayerStatsDiagnosisCode;
  readonly rowCount: number;
  readonly playerCount: number;
}

export function classifyPlayerStatsCoverage(input: {
  readonly status: GameStatus;
  readonly hasProviderMapping: boolean;
  readonly rowCount: number;
  readonly coverage: {
    readonly providerRows: number;
    readonly resolvedRows: number;
    readonly unresolvedRows: number;
  } | null;
}): PlayerStatsCoverage {
  if (input.rowCount === 0) {
    if (!input.hasProviderMapping) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'MISSING_PROVIDER_MAPPING',
        rowCount: 0,
        playerCount: 0,
      };
    }
    if (!isStatsExpected(input.status)) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'NOT_EXPECTED_YET',
        rowCount: 0,
        playerCount: 0,
      };
    }
    if (input.coverage !== null) {
      if (input.coverage.providerRows === 0) {
        return {
          state: 'UNAVAILABLE',
          reasonCode: 'PROVIDER_NO_PLAYER_STATS',
          rowCount: 0,
          playerCount: 0,
        };
      }
      if (input.coverage.unresolvedRows > 0) {
        return {
          state: 'MISSING',
          reasonCode: 'PLAYER_IDENTITY_UNRESOLVED',
          rowCount: 0,
          playerCount: 0,
        };
      }
    }
    return { state: 'MISSING', reasonCode: 'PROBE_REQUIRED', rowCount: 0, playerCount: 0 };
  }
  const partial = input.coverage !== null && input.coverage.unresolvedRows > 0;
  return {
    state: partial ? 'PARTIAL' : 'COMPLETE',
    reasonCode: partial ? 'PLAYER_IDENTITY_UNRESOLVED' : 'PLAYER_STATS_COMPLETE',
    rowCount: input.rowCount,
    playerCount: input.rowCount,
  };
}

// ---------------------------------------------------------------------------
// Play coverage (DB-only)
// ---------------------------------------------------------------------------

export interface PlaysCoverage {
  readonly state: DataHealthCoverageState;
  readonly reasonCode: PlaysDiagnosisCode;
  readonly activeCount: number;
  readonly reviewRequired: boolean;
}

export function classifyPlaysCoverage(input: {
  readonly status: GameStatus;
  readonly hasProviderMapping: boolean;
  readonly activeCount: number;
  readonly reviewRequired: boolean;
}): PlaysCoverage {
  if (input.reviewRequired) {
    return {
      state: 'PARTIAL',
      reasonCode: 'PLAYS_REVIEW_REQUIRED',
      activeCount: input.activeCount,
      reviewRequired: true,
    };
  }
  if (input.activeCount === 0) {
    if (!input.hasProviderMapping) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'MISSING_PROVIDER_MAPPING',
        activeCount: 0,
        reviewRequired: false,
      };
    }
    if (!isStatsExpected(input.status)) {
      return {
        state: dbOnlyEmptyState(input),
        reasonCode: 'PLAYS_PENDING',
        activeCount: 0,
        reviewRequired: false,
      };
    }
    return {
      state: 'MISSING',
      reasonCode: 'PROBE_REQUIRED',
      activeCount: 0,
      reviewRequired: false,
    };
  }
  const complete = input.status === 'FINAL';
  return {
    state: complete ? 'COMPLETE' : 'PARTIAL',
    reasonCode: complete ? 'PLAYS_COMPLETE' : 'PLAYS_PENDING',
    activeCount: input.activeCount,
    reviewRequired: false,
  };
}

// ---------------------------------------------------------------------------
// Provider-probe diagnosis (only ever computed with real provider data in hand)
// ---------------------------------------------------------------------------

export function classifyResultProbe(input: {
  readonly hasProviderMapping: boolean;
  readonly hasEditorialFallback: boolean;
  readonly dbStatus: GameStatus;
  readonly dbHomeScore: number | null;
  readonly dbAwayScore: number | null;
  readonly providerStatus: GameStatus | null;
  readonly providerHomeScore: number | null;
  readonly providerAwayScore: number | null;
}): ResultDiagnosisCode {
  if (!input.hasProviderMapping) {
    return input.hasEditorialFallback
      ? 'RESULT_USING_EDITORIAL_FALLBACK'
      : 'MISSING_PROVIDER_MAPPING';
  }
  if (input.providerStatus === null) return 'PROVIDER_RESULT_MISSING';
  if (input.hasEditorialFallback) {
    const agrees =
      input.providerStatus === input.dbStatus &&
      input.providerHomeScore === input.dbHomeScore &&
      input.providerAwayScore === input.dbAwayScore;
    return agrees ? 'RESULT_USING_EDITORIAL_FALLBACK' : 'RESULT_CONFLICT';
  }
  const providerHasScore = input.providerHomeScore !== null && input.providerAwayScore !== null;
  if (input.dbHomeScore === null || input.dbAwayScore === null) {
    return providerHasScore ? 'PROVIDER_HAS_RESULT_DB_MISSING' : 'RESULT_PENDING';
  }
  if (
    !providerHasScore ||
    input.providerHomeScore !== input.dbHomeScore ||
    input.providerAwayScore !== input.dbAwayScore ||
    input.providerStatus !== input.dbStatus
  ) {
    return 'RESULT_CONFLICT';
  }
  return 'RESULT_COMPLETE';
}

export function classifyTeamStatsProbe(input: {
  readonly hasProviderMapping: boolean;
  readonly notExpectedYet: boolean;
  readonly providerRowCount: number;
  readonly dbRowCount: number;
  readonly dbComplete: boolean;
}): TeamStatsDiagnosisCode {
  if (!input.hasProviderMapping) return 'MISSING_PROVIDER_MAPPING';
  if (input.notExpectedYet) return 'NOT_EXPECTED_YET';
  if (input.providerRowCount === 0) return 'PROVIDER_NO_TEAM_STATS';
  if (input.dbRowCount === 0) return 'PROVIDER_HAS_TEAM_STATS_DB_MISSING';
  if (!input.dbComplete) return 'DB_TEAM_STATS_PARTIAL';
  return 'TEAM_STATS_COMPLETE';
}

export function classifyPlayerStatsProbe(input: {
  readonly hasProviderMapping: boolean;
  readonly notExpectedYet: boolean;
  readonly providerRawRowCount: number;
  readonly resolvedPlayerCount: number;
  readonly unresolvedPlayerCount: number;
  readonly dbRowCount: number;
}): PlayerStatsDiagnosisCode {
  if (!input.hasProviderMapping) return 'MISSING_PROVIDER_MAPPING';
  if (input.notExpectedYet) return 'NOT_EXPECTED_YET';
  if (input.providerRawRowCount === 0) return 'PROVIDER_NO_PLAYER_STATS';
  if (input.dbRowCount === 0) {
    return input.unresolvedPlayerCount > 0
      ? 'PLAYER_IDENTITY_UNRESOLVED'
      : 'PROVIDER_HAS_PLAYER_STATS_DB_MISSING';
  }
  if (input.dbRowCount < input.resolvedPlayerCount) {
    return input.unresolvedPlayerCount > 0
      ? 'PLAYER_IDENTITY_UNRESOLVED'
      : 'DB_PLAYER_STATS_PARTIAL';
  }
  return 'PLAYER_STATS_COMPLETE';
}

export function classifyPlaysProbe(input: {
  readonly hasProviderMapping: boolean;
  readonly notExpectedYet: boolean;
  readonly reviewRequired: boolean;
  readonly providerPlayCount: number;
  readonly dbPlayCount: number;
}): PlaysDiagnosisCode {
  if (!input.hasProviderMapping) return 'MISSING_PROVIDER_MAPPING';
  if (input.reviewRequired) return 'PLAYS_REVIEW_REQUIRED';
  if (input.notExpectedYet) return 'PLAYS_PENDING';
  if (input.providerPlayCount === 0) return 'PROVIDER_NO_PLAYS';
  if (input.dbPlayCount === 0) return 'PROVIDER_HAS_PLAYS_DB_MISSING';
  if (input.dbPlayCount < input.providerPlayCount) return 'PLAYS_PARTIAL';
  return 'PLAYS_COMPLETE';
}
