import { AppError } from '../../common/errors/app-error.js';
import type { CurrentGameDetailsRepository } from '../sports/current-game-details.repository.js';
import { classifyCurrentGameTeamStats } from '../sports/current-game-team-stat-coverage.js';
import { reconcileCurrentPlayer } from '../sports/current-player-reconciliation.js';
import { HighlightlyEvaluationError } from '../sports/evaluation/highlightly/highlightly-http-client.js';
import type { HighlightlyEvaluationHttpClient } from '../sports/evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyBoxScoreResponseSchema,
  type HighlightlyBoxScoreResponse,
} from '../sports/evaluation/highlightly/highlightly-schemas.js';
import type { MatchDetailFetcher } from '../sports/live-game-validation.js';
import { normalizeHighlightlyCurrentGameDetails } from '../sports/providers/highlightly/highlightly-current-game-details-provider.js';
import { normalizeHighlightlyCurrentGamePlays } from '../sports/providers/highlightly/highlightly-current-game-play-provider.js';
import {
  mapHighlightlyStatus,
  parseHighlightlyScore,
} from '../sports/providers/highlightly/highlightly-current-game-provider.js';
import { CurrentGameSyncError } from '../sports/sync-current-games.js';
import {
  classifyPlayerStatsProbe,
  classifyPlaysProbe,
  classifyResultProbe,
  classifyTeamStatsProbe,
  isStatsExpected,
  type PlayerStatsDiagnosisCode,
  type PlaysDiagnosisCode,
  type ResultDiagnosisCode,
  type TeamStatsDiagnosisCode,
} from './data-health-diagnosis.js';
import type { DataHealthRepository } from './data-health.repository.js';

const HIGHLIGHTLY_PROVIDER = 'highlightly';

export interface DataHealthProbeResult {
  readonly gameId: string;
  readonly checkedAt: string;
  readonly provider: {
    readonly reachable: boolean;
    readonly matchFound: boolean;
    readonly requestCount: number;
    readonly durationMs: number;
    readonly quotaLimit: number | null;
    readonly quotaRemaining: number | null;
  };
  readonly result: {
    readonly providerAvailable: boolean;
    readonly providerStatus: string | null;
    readonly scoreAvailable: boolean;
    readonly diagnosis: ResultDiagnosisCode;
    readonly explanation: string;
  };
  readonly teamStats: {
    readonly providerAvailable: boolean;
    readonly rawRows: number;
    readonly normalizedRows: number;
    readonly databaseRows: number;
    readonly diagnosis: TeamStatsDiagnosisCode;
    readonly explanation: string;
  };
  readonly playerStats: {
    readonly providerAvailable: boolean;
    readonly rawRows: number;
    readonly normalizedRows: number;
    readonly resolvedPlayers: number;
    readonly unresolvedPlayers: number;
    readonly databaseRows: number;
    readonly diagnosis: PlayerStatsDiagnosisCode;
    readonly explanation: string;
  };
  readonly plays: {
    readonly providerAvailable: boolean;
    readonly rawCount: number;
    readonly normalizedCount: number;
    readonly databaseActiveCount: number;
    readonly diagnosis: PlaysDiagnosisCode;
    readonly explanation: string;
  };
}

/** Sanitized provider-error taxonomy -- never the raw message/body, matching the
 * `classifyError` convention already used by the live-validation diagnostic harness. */
function classifyProbeError(error: unknown): string {
  if (error instanceof HighlightlyEvaluationError) return error.code;
  if (error instanceof CurrentGameSyncError) return error.code;
  return 'OTHER';
}

function countBoxScoreRows(boxScore: HighlightlyBoxScoreResponse): number {
  return boxScore.reduce((total, entry) => total + entry.team.boxScores.length, 0);
}

export class GameDataHealthProbeService {
  constructor(
    private readonly detailsRepository: CurrentGameDetailsRepository,
    private readonly dataHealthRepository: DataHealthRepository,
    private readonly matchDetailFetcher: MatchDetailFetcher,
    private readonly client: HighlightlyEvaluationHttpClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async probe(gameId: string): Promise<DataHealthProbeResult> {
    const checkedAt = this.now();
    const startedAt = performance.now();
    const requestCountBefore = this.client.getRequestCount();

    const [target, context] = await Promise.all([
      this.detailsRepository.findTarget(gameId, HIGHLIGHTLY_PROVIDER),
      this.dataHealthRepository.getProbeGameContext(gameId),
    ]);
    if (target === null || context === null) {
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The internal game was not found.',
        statusCode: 404,
      });
    }

    const notExpectedYet = !isStatsExpected(context.status);
    const dbTeamStatsComplete =
      classifyCurrentGameTeamStats({
        rows: target.teamStats,
        homeTeamId: target.homeTeamId,
        awayTeamId: target.awayTeamId,
      }).classification === 'COMPLETE';

    if (target.providerMapping === null) {
      return this.finish({
        gameId,
        checkedAt,
        requestCount: 0,
        durationMs: rounded(performance.now() - startedAt),
        providerReachable: false,
        providerMatchFound: false,
        quotaLimit: null,
        quotaRemaining: null,
        errorCode: null,
        result: {
          providerAvailable: false,
          providerStatus: null,
          scoreAvailable: false,
          diagnosis: context.hasEditorialFallback
            ? 'RESULT_USING_EDITORIAL_FALLBACK'
            : 'MISSING_PROVIDER_MAPPING',
          explanation:
            'The game has no verified Highlightly provider mapping, so no provider request was made.',
        },
        teamStats: {
          providerAvailable: false,
          rawRows: 0,
          normalizedRows: 0,
          databaseRows: target.teamStats.length,
          diagnosis: 'MISSING_PROVIDER_MAPPING',
          explanation: 'The game has no verified Highlightly provider mapping.',
        },
        playerStats: {
          providerAvailable: false,
          rawRows: 0,
          normalizedRows: 0,
          resolvedPlayers: 0,
          unresolvedPlayers: 0,
          databaseRows: target.playerStats.length,
          diagnosis: 'MISSING_PROVIDER_MAPPING',
          explanation: 'The game has no verified Highlightly provider mapping.',
        },
        plays: {
          providerAvailable: false,
          rawCount: 0,
          normalizedCount: 0,
          databaseActiveCount: context.activePlayCount,
          diagnosis: 'MISSING_PROVIDER_MAPPING',
          explanation: 'The game has no verified Highlightly provider mapping.',
        },
      });
    }

    const providerGameId = target.providerMapping.providerGameId;
    let providerReachable = true;
    let matchFound = false;
    let detailErrorCode: string | null = null;
    let detail: Awaited<ReturnType<MatchDetailFetcher['fetch']>>['detail'] = null;
    try {
      const fetched = await this.matchDetailFetcher.fetch(providerGameId);
      detail = fetched.detail;
      matchFound = detail !== null;
      if (detail === null) detailErrorCode = 'MATCH_NOT_FOUND';
    } catch (error: unknown) {
      providerReachable = false;
      detailErrorCode = classifyProbeError(error);
    }

    if (detail === null) {
      const quota = this.client.getRateLimitObservation();
      return this.finish({
        gameId,
        checkedAt,
        requestCount: this.client.getRequestCount() - requestCountBefore,
        durationMs: rounded(performance.now() - startedAt),
        providerReachable,
        providerMatchFound: false,
        quotaLimit: quota.limit,
        quotaRemaining: quota.remaining,
        errorCode: detailErrorCode,
        result: {
          providerAvailable: false,
          providerStatus: null,
          scoreAvailable: false,
          diagnosis: 'PROVIDER_REQUEST_FAILED',
          explanation: `The Highlightly match request failed or the match could not be found (${detailErrorCode ?? 'unknown'}).`,
        },
        teamStats: {
          providerAvailable: false,
          rawRows: 0,
          normalizedRows: 0,
          databaseRows: target.teamStats.length,
          diagnosis: 'PROVIDER_REQUEST_FAILED',
          explanation: 'Team statistics could not be checked because the match request failed.',
        },
        playerStats: {
          providerAvailable: false,
          rawRows: 0,
          normalizedRows: 0,
          resolvedPlayers: 0,
          unresolvedPlayers: 0,
          databaseRows: target.playerStats.length,
          diagnosis: 'PROVIDER_REQUEST_FAILED',
          explanation: 'Player statistics could not be checked because the match request failed.',
        },
        plays: {
          providerAvailable: false,
          rawCount: 0,
          normalizedCount: 0,
          databaseActiveCount: context.activePlayCount,
          diagnosis: 'PROVIDER_REQUEST_FAILED',
          explanation: 'Plays could not be checked because the match request failed.',
        },
      });
    }

    // --- Result -------------------------------------------------------------
    const providerStatus = mapHighlightlyStatus(
      detail.state.description ?? detail.state.report ?? '',
    );
    const providerScore = parseHighlightlyScore(detail.state.score?.current ?? null);
    const resultDiagnosis = classifyResultProbe({
      hasProviderMapping: true,
      hasEditorialFallback: context.hasEditorialFallback,
      dbStatus: context.status,
      dbHomeScore: context.homeScore,
      dbAwayScore: context.awayScore,
      providerStatus,
      providerHomeScore: providerScore?.home ?? null,
      providerAwayScore: providerScore?.away ?? null,
    });

    // --- Team stats (never requires the box score) ---------------------------
    // The provider legitimately having no team statistics yet (matchStatistics absent) is a
    // normal state, not a failure -- checked directly rather than via the normalizer's throw,
    // so it does not get misclassified as PROVIDER_REQUEST_FAILED.
    const providerHasTeamStats =
      detail.matchStatistics !== null && detail.matchStatistics !== undefined;
    let teamStatsAvailable = false;
    let teamStatsErrorCode: string | null = null;
    if (providerHasTeamStats) {
      try {
        normalizeHighlightlyCurrentGameDetails(detail, [], providerGameId, false);
        teamStatsAvailable = true;
      } catch (error: unknown) {
        teamStatsErrorCode = classifyProbeError(error);
      }
    }
    const teamStatsDiagnosis =
      teamStatsErrorCode !== null
        ? 'PROVIDER_REQUEST_FAILED'
        : classifyTeamStatsProbe({
            hasProviderMapping: true,
            notExpectedYet,
            providerRowCount: teamStatsAvailable ? 2 : 0,
            dbRowCount: target.teamStats.length,
            dbComplete: dbTeamStatsComplete,
          });

    // --- Plays (off the same match-detail payload, no extra request) --------
    let playsRawCount = 0;
    let playsErrorCode: string | null = null;
    try {
      const playsSnapshot = normalizeHighlightlyCurrentGamePlays(detail, providerGameId);
      playsRawCount = playsSnapshot.plays.length;
    } catch (error: unknown) {
      playsErrorCode = classifyProbeError(error);
    }
    const playsDiagnosis =
      playsErrorCode !== null
        ? 'PROVIDER_REQUEST_FAILED'
        : classifyPlaysProbe({
            hasProviderMapping: true,
            notExpectedYet,
            reviewRequired: false,
            providerPlayCount: playsRawCount,
            dbPlayCount: context.activePlayCount,
          });

    // --- Player stats: the one section that requires a second request -------
    let boxScore: HighlightlyBoxScoreResponse = [];
    let boxScoreFetched = false;
    let boxScoreErrorCode: string | null = null;
    try {
      boxScore = await this.client.get(
        `/box-score/${providerGameId}`,
        {},
        highlightlyBoxScoreResponseSchema,
      );
      boxScoreFetched = true;
    } catch (error: unknown) {
      boxScoreErrorCode = classifyProbeError(error);
    }

    let playerStatsRawRows = 0;
    let playerStatsNormalizedRows = 0;
    let resolvedPlayerCount = 0;
    let unresolvedPlayerCount = 0;
    let playerStatsErrorCode: string | null = null;
    let playerStatsProviderAvailable = false;

    if (!boxScoreFetched) {
      playerStatsErrorCode = boxScoreErrorCode;
    } else if (countBoxScoreRows(boxScore) === 0) {
      // No player rows on either side yet -- a legitimate empty state (matches the
      // requireBoxScore=false / boxTeams.size!==2 guard in normalizeHighlightlyCurrentGameDetails,
      // which would otherwise throw on a box score that doesn't cover both sides).
      playerStatsProviderAvailable = false;
    } else {
      try {
        const normalized = normalizeHighlightlyCurrentGameDetails(
          detail,
          boxScore,
          providerGameId,
          true,
        );
        playerStatsProviderAvailable = true;
        playerStatsRawRows = countBoxScoreRows(boxScore);
        playerStatsNormalizedRows = normalized.playerStats.length;
        const mappings = await this.detailsRepository.findPlayerMappings(
          HIGHLIGHTLY_PROVIDER,
          normalized.playerStats.map((row) => row.providerPlayerId),
        );
        for (const row of normalized.playerStats) {
          const teamId =
            row.teamProviderId === normalized.homeProviderTeamId
              ? target.homeTeamId
              : target.awayTeamId;
          const resolution = reconcileCurrentPlayer({
            providerPlayerId: row.providerPlayerId,
            boxScoreName: row.displayName,
            teamId,
            teamProviderId: row.teamProviderId,
            existingPlayerId: mappings.get(row.providerPlayerId),
            profile: undefined,
            candidates: [],
          });
          if (resolution.playerId !== null) resolvedPlayerCount += 1;
          else unresolvedPlayerCount += 1;
        }
      } catch (error: unknown) {
        playerStatsErrorCode = classifyProbeError(error);
      }
    }

    const playerStatsDiagnosis =
      playerStatsErrorCode !== null
        ? 'PROVIDER_REQUEST_FAILED'
        : classifyPlayerStatsProbe({
            hasProviderMapping: true,
            notExpectedYet,
            providerRawRowCount: playerStatsRawRows,
            resolvedPlayerCount,
            unresolvedPlayerCount,
            dbRowCount: target.playerStats.length,
          });

    const quota = this.client.getRateLimitObservation();
    const errorCode =
      detailErrorCode ?? teamStatsErrorCode ?? playsErrorCode ?? playerStatsErrorCode;

    return this.finish({
      gameId,
      checkedAt,
      requestCount: this.client.getRequestCount() - requestCountBefore,
      durationMs: rounded(performance.now() - startedAt),
      providerReachable,
      providerMatchFound: matchFound,
      quotaLimit: quota.limit,
      quotaRemaining: quota.remaining,
      errorCode,
      result: {
        providerAvailable: providerStatus !== null,
        providerStatus,
        scoreAvailable: providerScore !== null,
        diagnosis: resultDiagnosis,
        explanation: explainResult(resultDiagnosis, providerStatus),
      },
      teamStats: {
        providerAvailable: teamStatsAvailable,
        rawRows: teamStatsAvailable ? 2 : 0,
        normalizedRows: teamStatsAvailable ? 2 : 0,
        databaseRows: target.teamStats.length,
        diagnosis: teamStatsDiagnosis,
        explanation: explainTeamStats(teamStatsDiagnosis, target.teamStats.length),
      },
      playerStats: {
        providerAvailable: playerStatsProviderAvailable,
        rawRows: playerStatsRawRows,
        normalizedRows: playerStatsNormalizedRows,
        resolvedPlayers: resolvedPlayerCount,
        unresolvedPlayers: unresolvedPlayerCount,
        databaseRows: target.playerStats.length,
        diagnosis: playerStatsDiagnosis,
        explanation: explainPlayerStats(
          playerStatsDiagnosis,
          playerStatsRawRows,
          resolvedPlayerCount,
          target.playerStats.length,
        ),
      },
      plays: {
        providerAvailable: playsErrorCode === null,
        rawCount: playsRawCount,
        normalizedCount: playsRawCount,
        databaseActiveCount: context.activePlayCount,
        diagnosis: playsDiagnosis,
        explanation: explainPlays(playsDiagnosis, playsRawCount, context.activePlayCount),
      },
    });
  }

  private async finish(input: {
    readonly gameId: string;
    readonly checkedAt: Date;
    readonly requestCount: number;
    readonly durationMs: number;
    readonly providerReachable: boolean;
    readonly providerMatchFound: boolean;
    readonly quotaLimit: number | null;
    readonly quotaRemaining: number | null;
    readonly errorCode: string | null;
    readonly result: DataHealthProbeResult['result'];
    readonly teamStats: DataHealthProbeResult['teamStats'];
    readonly playerStats: DataHealthProbeResult['playerStats'];
    readonly plays: DataHealthProbeResult['plays'];
  }): Promise<DataHealthProbeResult> {
    await this.dataHealthRepository.saveProbe({
      gameId: input.gameId,
      checkedAt: input.checkedAt,
      requestCount: input.requestCount,
      durationMs: input.durationMs,
      providerReachable: input.providerReachable,
      providerMatchFound: input.providerMatchFound,
      quotaLimit: input.quotaLimit,
      quotaRemaining: input.quotaRemaining,
      resultDiagnosis: input.result.diagnosis,
      teamStatsDiagnosis: input.teamStats.diagnosis,
      playerStatsDiagnosis: input.playerStats.diagnosis,
      playsDiagnosis: input.plays.diagnosis,
      providerTeamStatRows: input.teamStats.rawRows,
      dbTeamStatRows: input.teamStats.databaseRows,
      providerPlayerStatRows: input.playerStats.rawRows,
      normalizedPlayerStatRows: input.playerStats.normalizedRows,
      resolvedPlayerCount: input.playerStats.resolvedPlayers,
      unresolvedPlayerCount: input.playerStats.unresolvedPlayers,
      dbPlayerStatRows: input.playerStats.databaseRows,
      providerPlayCount: input.plays.rawCount,
      dbPlayCount: input.plays.databaseActiveCount,
      errorCode: input.errorCode,
    });
    return {
      gameId: input.gameId,
      checkedAt: input.checkedAt.toISOString(),
      provider: {
        reachable: input.providerReachable,
        matchFound: input.providerMatchFound,
        requestCount: input.requestCount,
        durationMs: input.durationMs,
        quotaLimit: input.quotaLimit,
        quotaRemaining: input.quotaRemaining,
      },
      result: input.result,
      teamStats: input.teamStats,
      playerStats: input.playerStats,
      plays: input.plays,
    };
  }
}

function rounded(value: number): number {
  return Math.round(value);
}

function explainResult(code: ResultDiagnosisCode, providerStatus: string | null): string {
  switch (code) {
    case 'RESULT_COMPLETE':
      return 'The provider result matches what is stored.';
    case 'RESULT_USING_EDITORIAL_FALLBACK':
      return 'An editorial result fallback is in effect and agrees with the provider (or the provider has no result yet).';
    case 'RESULT_CONFLICT':
      return 'The provider result disagrees with what is stored; the stored value was not changed.';
    case 'PROVIDER_HAS_RESULT_DB_MISSING':
      return 'The provider has a final score that the database does not yet have.';
    case 'PROVIDER_RESULT_MISSING':
      return `The provider has not reported a usable game state (${providerStatus ?? 'unrecognized'}).`;
    case 'RESULT_PENDING':
      return 'The game has not reached a state where a final result is expected yet.';
    case 'MISSING_PROVIDER_MAPPING':
      return 'The game has no verified Highlightly provider mapping.';
    case 'PROVIDER_REQUEST_FAILED':
      return 'The provider request failed.';
    default:
      return code;
  }
}

function explainTeamStats(code: TeamStatsDiagnosisCode, dbRows: number): string {
  switch (code) {
    case 'TEAM_STATS_COMPLETE':
      return `Highlightly has team statistics and the database has ${String(dbRows)} matching rows.`;
    case 'PROVIDER_HAS_TEAM_STATS_DB_MISSING':
      return 'Highlightly returned team statistics but the database has none. Likely ingestion/persistence gap.';
    case 'PROVIDER_NO_TEAM_STATS':
      return 'Highlightly has not published team statistics for this game yet.';
    case 'DB_TEAM_STATS_PARTIAL':
      return `The database has ${String(dbRows)} team-stat row(s) but they are not orientation-complete or are missing core fields.`;
    case 'NOT_EXPECTED_YET':
      return 'The game has not reached a stage where team statistics are expected.';
    case 'MISSING_PROVIDER_MAPPING':
      return 'The game has no verified Highlightly provider mapping.';
    case 'PROVIDER_REQUEST_FAILED':
      return 'The provider request failed.';
    default:
      return code;
  }
}

function explainPlayerStats(
  code: PlayerStatsDiagnosisCode,
  providerRows: number,
  resolvedPlayers: number,
  dbRows: number,
): string {
  switch (code) {
    case 'PLAYER_STATS_COMPLETE':
      return `Highlightly returned ${String(providerRows)} player stat records and the database has ${String(dbRows)} matching rows.`;
    case 'PROVIDER_HAS_PLAYER_STATS_DB_MISSING':
      return `Highlightly returned ${String(providerRows)} player stat records. ${String(resolvedPlayers)} players resolved to internal player identities. The database contains 0 CurrentGamePlayerStat rows. Likely ingestion/persistence gap.`;
    case 'PLAYER_IDENTITY_UNRESOLVED':
      return `Highlightly returned ${String(providerRows)} player stat records, but not all could be tied to internal players without a full profile lookup (only ${String(resolvedPlayers)} resolved via existing mappings). This probe does not fetch individual player profiles, so this count is an upper bound on unresolved players.`;
    case 'DB_PLAYER_STATS_PARTIAL':
      return `Highlightly has more resolvable player coverage (${String(resolvedPlayers)}) than is currently persisted (${String(dbRows)}).`;
    case 'PROVIDER_NO_PLAYER_STATS':
      return 'Highlightly has not published player statistics for this game yet.';
    case 'NOT_EXPECTED_YET':
      return 'The game has not reached a stage where player statistics are expected.';
    case 'MISSING_PROVIDER_MAPPING':
      return 'The game has no verified Highlightly provider mapping.';
    case 'PROVIDER_REQUEST_FAILED':
      return 'The provider request failed.';
    default:
      return code;
  }
}

function explainPlays(code: PlaysDiagnosisCode, providerCount: number, dbCount: number): string {
  switch (code) {
    case 'PLAYS_COMPLETE':
      return `Highlightly returned ${String(providerCount)} plays and the database has ${String(dbCount)} active rows.`;
    case 'PROVIDER_HAS_PLAYS_DB_MISSING':
      return `Highlightly returned ${String(providerCount)} plays but the database has none. Likely ingestion/persistence gap.`;
    case 'PLAYS_PARTIAL':
      return `Highlightly returned ${String(providerCount)} plays; the database has ${String(dbCount)} active rows.`;
    case 'PROVIDER_NO_PLAYS':
      return 'Highlightly has not published plays for this game yet.';
    case 'PLAYS_PENDING':
      return 'The game has not reached a stage where plays are expected.';
    case 'PLAYS_REVIEW_REQUIRED':
      return 'Play reconciliation is blocked and requires operator review (see the plays diagnostic endpoint).';
    case 'MISSING_PROVIDER_MAPPING':
      return 'The game has no verified Highlightly provider mapping.';
    case 'PROVIDER_REQUEST_FAILED':
      return 'The provider request failed.';
    default:
      return code;
  }
}
