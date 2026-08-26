import type { Prisma } from '../../generated/prisma/client.js';
import {
  classifyPlayerStatsCoverage,
  classifyPlaysCoverage,
  classifyResultCoverage,
  classifyTeamStatsCoverage,
  type DataHealthCoverageState,
  type PlayerStatsDiagnosisCode,
  type ResultDiagnosisCode,
  type TeamStatsDiagnosisCode,
} from './data-health-diagnosis.js';

const HIGHLIGHTLY_PROVIDER = 'highlightly';

export const dataHealthGameListInclude = {
  homeTeam: { select: { abbreviation: true, fullName: true } },
  awayTeam: { select: { abbreviation: true, fullName: true } },
  editorialOverride: {
    select: { status: true, homeScore: true, awayScore: true, resultVerifiedAt: true },
  },
  providerMaps: { where: { provider: HIGHLIGHTLY_PROVIDER }, select: { id: true } },
  currentTeamStats: true,
  currentPlayerCoverage: true,
  pollState: { select: { playsReviewRequired: true } },
  dataHealthProbes: { orderBy: { checkedAt: 'desc' }, take: 1 },
  _count: { select: { currentPlayerStats: true } },
} satisfies Prisma.GameInclude;

export type DataHealthGameListRow = Prisma.GameGetPayload<{
  include: typeof dataHealthGameListInclude;
}>;

export interface DataHealthGameRow {
  readonly gameId: string;
  readonly season: number;
  readonly seasonType: string;
  readonly week: number | null;
  readonly kickoff: string | null;
  readonly status: string;
  readonly awayTeam: { readonly id: string; readonly abbreviation: string; readonly name: string };
  readonly homeTeam: { readonly id: string; readonly abbreviation: string; readonly name: string };
  readonly result: {
    readonly state: DataHealthCoverageState;
    readonly homeScore: number | null;
    readonly awayScore: number | null;
    readonly source: 'PROVIDER' | 'EDITORIAL_FALLBACK' | 'NONE';
    readonly reasonCode: ResultDiagnosisCode;
  };
  readonly providerMapping: { readonly available: boolean };
  readonly teamStats: {
    readonly state: DataHealthCoverageState;
    readonly rowCount: number;
    readonly expectedRowCount: 2;
    readonly reasonCode: TeamStatsDiagnosisCode;
  };
  readonly playerStats: {
    readonly state: DataHealthCoverageState;
    readonly rowCount: number;
    readonly playerCount: number;
    readonly reasonCode: PlayerStatsDiagnosisCode;
  };
  readonly plays: {
    readonly state: DataHealthCoverageState;
    readonly activeCount: number;
    readonly reviewRequired: boolean;
  };
  readonly lastProbe: {
    readonly checkedAt: string;
    readonly providerReachable: boolean;
    readonly playerStatsDiagnosis: string;
    readonly teamStatsDiagnosis: string;
    readonly resultDiagnosis: string;
    readonly playsDiagnosis: string;
  } | null;
  readonly needsInvestigation: boolean;
}

export function toDataHealthGameRow(
  game: DataHealthGameListRow,
  activePlayCount: number,
): DataHealthGameRow {
  const hasProviderMapping = game.providerMaps.length > 0;
  const hasEditorialFallback =
    game.editorialOverride?.status === 'FINAL' &&
    game.editorialOverride.homeScore !== null &&
    game.editorialOverride.awayScore !== null;
  const homeScore = game.editorialOverride?.homeScore ?? game.homeScore;
  const awayScore = game.editorialOverride?.awayScore ?? game.awayScore;
  const status = game.editorialOverride?.status ?? game.status;

  const result = classifyResultCoverage({
    status,
    homeScore,
    awayScore,
    hasProviderMapping,
    hasEditorialFallback,
  });
  const teamStats = classifyTeamStatsCoverage({
    status,
    hasProviderMapping,
    rows: game.currentTeamStats,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
  });
  const playerStats = classifyPlayerStatsCoverage({
    status,
    hasProviderMapping,
    rowCount: game._count.currentPlayerStats,
    coverage: game.currentPlayerCoverage,
  });
  const plays = classifyPlaysCoverage({
    status,
    hasProviderMapping,
    activeCount: activePlayCount,
    reviewRequired: game.pollState?.playsReviewRequired ?? false,
  });
  const lastProbeRow = game.dataHealthProbes[0] ?? null;

  const needsInvestigation =
    [result.state, teamStats.state, playerStats.state, plays.state].includes('MISSING') ||
    [result.state, teamStats.state, playerStats.state, plays.state].includes('PARTIAL') ||
    [result.state, teamStats.state, playerStats.state, plays.state].includes('UNKNOWN');

  return {
    gameId: game.id,
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    kickoff: game.startTime?.toISOString() ?? null,
    status,
    awayTeam: {
      id: game.awayTeamId,
      abbreviation: game.awayTeam.abbreviation,
      name: game.awayTeam.fullName,
    },
    homeTeam: {
      id: game.homeTeamId,
      abbreviation: game.homeTeam.abbreviation,
      name: game.homeTeam.fullName,
    },
    result: {
      state: result.state,
      homeScore,
      awayScore,
      source: hasEditorialFallback ? 'EDITORIAL_FALLBACK' : hasScoreSource(homeScore, awayScore),
      reasonCode: result.reasonCode,
    },
    providerMapping: { available: hasProviderMapping },
    teamStats: {
      state: teamStats.state,
      rowCount: teamStats.rowCount,
      expectedRowCount: teamStats.expectedRowCount,
      reasonCode: teamStats.reasonCode,
    },
    playerStats: {
      state: playerStats.state,
      rowCount: playerStats.rowCount,
      playerCount: playerStats.playerCount,
      reasonCode: playerStats.reasonCode,
    },
    plays: {
      state: plays.state,
      activeCount: plays.activeCount,
      reviewRequired: plays.reviewRequired,
    },
    lastProbe:
      lastProbeRow === null
        ? null
        : {
            checkedAt: lastProbeRow.checkedAt.toISOString(),
            providerReachable: lastProbeRow.providerReachable,
            playerStatsDiagnosis: lastProbeRow.playerStatsDiagnosis,
            teamStatsDiagnosis: lastProbeRow.teamStatsDiagnosis,
            resultDiagnosis: lastProbeRow.resultDiagnosis,
            playsDiagnosis: lastProbeRow.playsDiagnosis,
          },
    needsInvestigation,
  };
}

function hasScoreSource(homeScore: number | null, awayScore: number | null): 'PROVIDER' | 'NONE' {
  return homeScore !== null && awayScore !== null ? 'PROVIDER' : 'NONE';
}

export interface DataHealthSummary {
  readonly games: number;
  readonly resultsComplete: number;
  readonly resultsMissing: number;
  readonly teamStatsComplete: number;
  readonly teamStatsMissing: number;
  readonly playerStatsComplete: number;
  readonly playerStatsMissing: number;
  readonly playsAvailable: number;
  readonly needsInvestigation: number;
}

export function summarizeDataHealthRows(rows: readonly DataHealthGameRow[]): DataHealthSummary {
  return {
    games: rows.length,
    resultsComplete: rows.filter((row) => row.result.state === 'COMPLETE').length,
    resultsMissing: rows.filter((row) => row.result.state === 'MISSING').length,
    teamStatsComplete: rows.filter((row) => row.teamStats.state === 'COMPLETE').length,
    teamStatsMissing: rows.filter((row) => row.teamStats.state === 'MISSING').length,
    playerStatsComplete: rows.filter((row) => row.playerStats.state === 'COMPLETE').length,
    playerStatsMissing: rows.filter((row) => row.playerStats.state === 'MISSING').length,
    playsAvailable: rows.filter((row) => row.plays.activeCount > 0).length,
    needsInvestigation: rows.filter((row) => row.needsInvestigation).length,
  };
}

// ---------------------------------------------------------------------------
// Detail endpoint
// ---------------------------------------------------------------------------

export const dataHealthGameDetailInclude = {
  homeTeam: { select: { abbreviation: true, fullName: true } },
  awayTeam: { select: { abbreviation: true, fullName: true } },
  editorialOverride: true,
  providerMaps: { where: { provider: HIGHLIGHTLY_PROVIDER }, select: { id: true } },
  currentTeamStats: true,
  currentPlayerStats: {
    select: {
      id: true,
      teamId: true,
      playerId: true,
      sourceUpdatedAt: true,
      player: { select: { displayName: true } },
    },
  },
  currentPlayerCoverage: true,
  pollState: true,
  dataHealthProbes: { orderBy: { checkedAt: 'desc' }, take: 1 },
} satisfies Prisma.GameInclude;

export type DataHealthGameDetailRow = Prisma.GameGetPayload<{
  include: typeof dataHealthGameDetailInclude;
}>;

export function toDataHealthGameDetailDto(
  game: DataHealthGameDetailRow,
  plays: { readonly activeCount: number; readonly supersededCount: number },
) {
  const hasProviderMapping = game.providerMaps.length > 0;
  const hasEditorialFallback =
    game.editorialOverride?.status === 'FINAL' &&
    game.editorialOverride.homeScore !== null &&
    game.editorialOverride.awayScore !== null;
  const status = game.editorialOverride?.status ?? game.status;
  const homeScore = game.editorialOverride?.homeScore ?? game.homeScore;
  const awayScore = game.editorialOverride?.awayScore ?? game.awayScore;

  const result = classifyResultCoverage({
    status,
    homeScore,
    awayScore,
    hasProviderMapping,
    hasEditorialFallback,
  });
  const teamStats = classifyTeamStatsCoverage({
    status,
    hasProviderMapping,
    rows: game.currentTeamStats,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
  });
  const playerStats = classifyPlayerStatsCoverage({
    status,
    hasProviderMapping,
    rowCount: game.currentPlayerStats.length,
    coverage: game.currentPlayerCoverage,
  });
  const playsCoverage = classifyPlaysCoverage({
    status,
    hasProviderMapping,
    activeCount: plays.activeCount,
    reviewRequired: game.pollState?.playsReviewRequired ?? false,
  });
  const lastProbeRow = game.dataHealthProbes[0] ?? null;

  return {
    gameId: game.id,
    status,
    homeScore,
    awayScore,
    hasResultFallback: hasEditorialFallback,
    providerMapping: { available: hasProviderMapping },
    result: { state: result.state, reasonCode: result.reasonCode },
    teamStats: {
      state: teamStats.state,
      rowCount: game.currentTeamStats.length,
      rows: game.currentTeamStats.map((row) => ({
        teamId: row.teamId,
        isHome: row.isHome,
        sourceProvider: row.sourceProvider,
        sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
      })),
      reasonCode: teamStats.reasonCode,
    },
    playerStats: {
      state: playerStats.state,
      totalRows: game.currentPlayerStats.length,
      uniquePlayers: game.currentPlayerStats.length,
      homeRows: game.currentPlayerStats.filter((row) => row.teamId === game.homeTeamId).length,
      awayRows: game.currentPlayerStats.filter((row) => row.teamId === game.awayTeamId).length,
      latestSourceUpdatedAt:
        game.currentPlayerStats
          .reduce<Date | null>(
            (latest, row) =>
              latest === null || row.sourceUpdatedAt > latest ? row.sourceUpdatedAt : latest,
            null,
          )
          ?.toISOString() ?? null,
      coverage:
        game.currentPlayerCoverage === null
          ? null
          : {
              providerRows: game.currentPlayerCoverage.providerRows,
              resolvedRows: game.currentPlayerCoverage.resolvedRows,
              unresolvedRows: game.currentPlayerCoverage.unresolvedRows,
            },
      reasonCode: playerStats.reasonCode,
    },
    plays: {
      state: playsCoverage.state,
      activeCount: plays.activeCount,
      supersededCount: plays.supersededCount,
      reviewRequired: playsCoverage.reviewRequired,
      blockedAt: game.pollState?.playsBlockedAt?.toISOString() ?? null,
      blockReason: game.pollState?.playsBlockReason ?? null,
    },
    poller:
      game.pollState === null
        ? null
        : {
            schedulingClass: game.pollState.schedulingClass,
            lastAttemptAt: game.pollState.lastAttemptAt?.toISOString() ?? null,
            lastSuccessAt: game.pollState.lastSuccessAt?.toISOString() ?? null,
            nextPollAt: game.pollState.nextPollAt?.toISOString() ?? null,
            lastError: game.pollState.lastError,
          },
    lastProbe:
      lastProbeRow === null
        ? null
        : {
            checkedAt: lastProbeRow.checkedAt.toISOString(),
            provider: lastProbeRow.provider,
            requestCount: lastProbeRow.requestCount,
            durationMs: lastProbeRow.durationMs,
            providerReachable: lastProbeRow.providerReachable,
            providerMatchFound: lastProbeRow.providerMatchFound,
            resultDiagnosis: lastProbeRow.resultDiagnosis,
            teamStatsDiagnosis: lastProbeRow.teamStatsDiagnosis,
            playerStatsDiagnosis: lastProbeRow.playerStatsDiagnosis,
            playsDiagnosis: lastProbeRow.playsDiagnosis,
            errorCode: lastProbeRow.errorCode,
          },
  };
}
