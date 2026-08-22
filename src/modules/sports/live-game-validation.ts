import type { GamePlay } from '../../generated/prisma/client.js';
import type { NormalizedCurrentGamePlaySnapshot } from './current-game-play-provider.js';
import type { CurrentGamePlayProvider } from './current-game-play-provider.js';
import type { CurrentGamePlayRepository } from './current-game-play.repository.js';
import { toTeamStatWrite } from './current-game-details.repository.js';
import {
  classifyCurrentGameTeamStats,
  type CurrentGameTeamStatCoverage,
} from './current-game-team-stat-coverage.js';
import type { HighlightlyDetailedMatch } from './evaluation/highlightly/highlightly-schemas.js';
import { normalizeHighlightlyCurrentGamePlays } from './providers/highlightly/highlightly-current-game-play-provider.js';
import { normalizeHighlightlyCurrentGameDetails } from './providers/highlightly/highlightly-current-game-details-provider.js';
import type { CurrentGameDetailsSyncService } from './sync-current-game-details.js';
import { identifyPlays, reconcilePlays } from './sync-current-game-plays.js';
import {
  CurrentGameSyncError,
  type CurrentGameSyncService,
  type CurrentGameExecutionPolicy,
} from './sync-current-games.js';
import { HighlightlyEvaluationError } from './evaluation/highlightly/highlightly-http-client.js';

type IdentifiedPlay = ReturnType<typeof identifyPlays>['plays'][number];

/**
 * Diagnostic-only: `/matches/{id}` is the exact payload both `CurrentGameDetailsSyncService`
 * (team stats, via HighlightlyCurrentGameDetailsProvider) and `CurrentGamePlaySyncService`
 * (plays, via HighlightlyCurrentGamePlayProvider) fetch independently in production. A dry
 * diagnostic tick has no write to protect, so it fetches that payload once and feeds it
 * through both real normalizers below. The `apply: true` path never uses this — it still
 * calls the untouched production services so the write-capable code path is unchanged.
 */
export interface MatchDetailFetchResult {
  readonly detail: HighlightlyDetailedMatch | null;
  readonly failureReason: string | null;
}

export interface MatchDetailFetcher {
  fetch(providerGameId: string): Promise<MatchDetailFetchResult>;
}

export interface LiveValidationDependencies {
  readonly gameSyncService: CurrentGameSyncService;
  readonly detailsService: CurrentGameDetailsSyncService;
  readonly playProvider: CurrentGamePlayProvider;
  readonly playRepository: CurrentGamePlayRepository;
  readonly matchDetailFetcher: MatchDetailFetcher;
  readonly requestCounter: { getRequestCount(): number };
  readonly rateLimitObservation: () => {
    readonly limit: number | null;
    readonly remaining: number | null;
  };
  readonly now: () => Date;
}

export interface LiveValidationTickInput {
  readonly gameId: string;
  readonly apply: boolean;
  readonly policy: CurrentGameExecutionPolicy;
  readonly tickIndex: number;
  readonly previousPlays: readonly GamePlay[];
  readonly firstObservedAt: Map<string, string>;
}

export interface RequestOutcome {
  readonly ok: boolean;
  readonly attempted: boolean;
  readonly durationMs: number | null;
  readonly errorCategory: string | null;
  readonly errorMessage: string | null;
}

export interface PlayDiff {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly reordered: number;
  readonly collisions: number;
  readonly unresolved: number;
  readonly snapshotShorter: boolean;
}

export interface TickRecord {
  readonly type: 'tick';
  readonly tickIndex: number;
  readonly localRequestTimestamp: string;
  readonly requestUsageDelta: number;
  readonly rateLimitObservation: {
    readonly limit: number | null;
    readonly remaining: number | null;
  };
  readonly gameState: {
    readonly outcome: RequestOutcome;
    readonly internalStatusBefore: string | null;
    readonly providerStatus: string | null;
    readonly homeScore: number | null;
    readonly awayScore: number | null;
    readonly period: number | null;
    readonly clock: string | null;
  };
  readonly teamStats: {
    readonly outcome: RequestOutcome;
    readonly classification: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | null;
    readonly rowCount: number | null;
    readonly orientationValid: boolean | null;
    readonly nonNullFieldCount: number | null;
    readonly totalFieldSlots: number | null;
  };
  readonly plays: {
    readonly outcome: RequestOutcome;
    readonly providerPlayDetailsCount: number | null;
    readonly normalizedPlayCount: number | null;
    readonly unresolvedPossession: number | null;
    readonly unknownPlayTypes: number | null;
    readonly fieldPositionFailures: number | null;
    readonly vsStoredDb: PlayDiff | null;
    readonly vsPreviousTick: PlayDiff | null;
    readonly newlyObservedThisTick: readonly {
      readonly playKey: string;
      readonly sequence: number;
      readonly period: number;
      readonly clock: string;
      readonly description: string;
      readonly firstObservedAtLocal: string;
    }[];
  };
}

export interface LiveValidationTickResult {
  readonly record: TickRecord;
  readonly syntheticPlays: readonly GamePlay[];
}

export async function runLiveValidationTick(
  deps: LiveValidationDependencies,
  input: LiveValidationTickInput,
): Promise<LiveValidationTickResult> {
  const localRequestTimestamp = deps.now().toISOString();
  const requestCountBefore = deps.requestCounter.getRequestCount();

  const target = await deps.playRepository.findTarget(input.gameId, 'highlightly');
  if (target === null) {
    throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
  }
  if (target.providerMapping === null) {
    throw new CurrentGameSyncError(
      'GAME_PROVIDER_MAPPING_REQUIRED',
      'The internal game has no verified Highlightly provider mapping.',
    );
  }
  const internalStatusBefore = target.status;

  const gameState = await withOutcome(async () => {
    const report = await deps.gameSyncService.sync({
      gameId: input.gameId,
      apply: input.apply,
      policy: input.policy,
    });
    return report.results[0] ?? null;
  });

  const providerGameId = target.providerMapping.providerGameId;

  let teamStatsOutcome: RequestOutcome;
  let teamStatsCoverage: CurrentGameTeamStatCoverage | null = null;
  let playsOutcome: RequestOutcome;
  let snapshot: NormalizedCurrentGamePlaySnapshot | null = null;

  if (input.apply) {
    // Write-capable path: unchanged production services, unchanged request count.
    // Only reachable when publication is approved; plays can never apply pre-FINAL.
    const teamStats = await withOutcome(async () =>
      deps.detailsService.sync({
        gameId: input.gameId,
        includePlayerStats: false,
        apply: input.apply,
        policy: input.policy,
      }),
    );
    teamStatsOutcome = teamStats.outcome;
    teamStatsCoverage = teamStats.value?.coverage ?? null;

    const playsBatch = await withOutcome(() => deps.playProvider.getGamePlays(providerGameId));
    playsOutcome = playsBatch.outcome;
    snapshot = playsBatch.value?.record ?? null;
    if (playsOutcome.ok && snapshot === null) {
      playsOutcome = {
        ok: false,
        attempted: true,
        durationMs: playsOutcome.durationMs,
        errorCategory: 'CURRENT_GAME_PLAYS_INVALID',
        errorMessage: playsBatch.value?.failures[0]?.reason ?? 'Provider plays were unavailable.',
      };
    }
  } else {
    // Diagnostic-only path: one shared match-detail fetch feeds both the real
    // team-stat normalizer and the real play normalizer. No writes are possible here.
    const detailFetch = await withOutcome(() => deps.matchDetailFetcher.fetch(providerGameId));
    const detail = detailFetch.value?.detail ?? null;
    const sharedDurationMs = detailFetch.outcome.durationMs;

    if (detail === null) {
      const reason =
        detailFetch.value?.failureReason ??
        detailFetch.outcome.errorMessage ??
        'Match detail was unavailable.';
      teamStatsOutcome = detailFetch.outcome.ok
        ? {
            ok: false,
            attempted: true,
            durationMs: sharedDurationMs,
            errorCategory: 'CURRENT_GAME_DETAILS_INVALID',
            errorMessage: reason,
          }
        : detailFetch.outcome;
      playsOutcome = detailFetch.outcome.ok
        ? {
            ok: false,
            attempted: true,
            durationMs: sharedDurationMs,
            errorCategory: 'CURRENT_GAME_PLAYS_INVALID',
            errorMessage: reason,
          }
        : detailFetch.outcome;
    } else {
      try {
        const normalizedDetails = normalizeHighlightlyCurrentGameDetails(
          detail,
          [],
          providerGameId,
          false,
        );
        if (
          !sameAbbreviation(normalizedDetails.homeAbbreviation, target.homeAbbreviation) ||
          !sameAbbreviation(normalizedDetails.awayAbbreviation, target.awayAbbreviation)
        ) {
          throw new Error(
            'Provider details conflict with the verified game identity or orientation.',
          );
        }
        const sourceUpdatedAt = deps.now();
        const rows = [
          toTeamStatWrite({
            gameId: target.id,
            teamId: target.homeTeamId,
            isHome: true,
            stats: normalizedDetails.homeTeamStats,
            periods: normalizedDetails.homePeriodScores,
            provider: 'highlightly',
            sourceUpdatedAt,
          }),
          toTeamStatWrite({
            gameId: target.id,
            teamId: target.awayTeamId,
            isHome: false,
            stats: normalizedDetails.awayTeamStats,
            periods: normalizedDetails.awayPeriodScores,
            provider: 'highlightly',
            sourceUpdatedAt,
          }),
        ];
        teamStatsCoverage = classifyCurrentGameTeamStats({
          rows,
          homeTeamId: target.homeTeamId,
          awayTeamId: target.awayTeamId,
        });
        teamStatsOutcome = {
          ok: true,
          attempted: true,
          durationMs: sharedDurationMs,
          errorCategory: null,
          errorMessage: null,
        };
      } catch (error: unknown) {
        teamStatsOutcome = {
          ok: false,
          attempted: true,
          durationMs: sharedDurationMs,
          errorCategory: 'CURRENT_GAME_DETAILS_INVALID',
          errorMessage:
            error instanceof Error ? error.message : 'Team statistics were unavailable.',
        };
      }

      try {
        const playsSnapshot = normalizeHighlightlyCurrentGamePlays(detail, providerGameId);
        if (
          !sameAbbreviation(playsSnapshot.homeAbbreviation, target.homeAbbreviation) ||
          !sameAbbreviation(playsSnapshot.awayAbbreviation, target.awayAbbreviation)
        ) {
          playsOutcome = {
            ok: false,
            attempted: true,
            durationMs: sharedDurationMs,
            errorCategory: 'CURRENT_GAME_PLAYS_IDENTITY_MISMATCH',
            errorMessage: 'Provider plays conflict with the verified game identity or orientation.',
          };
        } else {
          snapshot = playsSnapshot;
          playsOutcome = {
            ok: true,
            attempted: true,
            durationMs: sharedDurationMs,
            errorCategory: null,
            errorMessage: null,
          };
        }
      } catch (error: unknown) {
        const classified = classifyError(error);
        playsOutcome = {
          ok: false,
          attempted: true,
          durationMs: sharedDurationMs,
          errorCategory: classified.category,
          errorMessage: classified.message,
        };
      }
    }
  }

  let normalizedPlayCount: number | null = null;
  let providerPlayDetailsCount: number | null = null;
  let unresolvedPossession: number | null = null;
  let unknownPlayTypes: number | null = null;
  let fieldPositionFailures: number | null = null;
  let vsStoredDb: PlayDiff | null = null;
  let vsPreviousTick: PlayDiff | null = null;
  const newlyObservedThisTick: TickRecord['plays']['newlyObservedThisTick'][number][] = [];
  let syntheticPlays: readonly GamePlay[] = input.previousPlays;

  if (snapshot !== null) {
    providerPlayDetailsCount = snapshot.plays.length;
    unknownPlayTypes = snapshot.plays.filter((play) => play.playType === 'OTHER').length;
    fieldPositionFailures = snapshot.plays.filter((play) => play.fieldPositionFailure).length;

    const identified = identifyPlays(input.gameId, 'highlightly', snapshot.plays, snapshot, target);
    normalizedPlayCount = identified.plays.length;
    unresolvedPossession = identified.plays.filter((play) => play.possessionTeamId === null).length;

    const sourceUpdatedAt =
      snapshot.providerUpdatedAt === null ? deps.now() : new Date(snapshot.providerUpdatedAt);

    const dbPlan = reconcilePlays(identified.plays, target.plays, sourceUpdatedAt);
    vsStoredDb = {
      inserted: dbPlan.inserted,
      updated: dbPlan.updated,
      unchanged: dbPlan.unchanged,
      reordered: dbPlan.reordered,
      collisions: dbPlan.collisions,
      unresolved: dbPlan.unresolved + dbPlan.unmatchedExisting,
      snapshotShorter: snapshot.plays.length < target.plays.length,
    };

    const tickPlan = reconcilePlays(identified.plays, input.previousPlays, sourceUpdatedAt);
    vsPreviousTick = {
      inserted: tickPlan.inserted,
      updated: tickPlan.updated,
      unchanged: tickPlan.unchanged,
      reordered: tickPlan.reordered,
      collisions: tickPlan.collisions,
      unresolved: tickPlan.unresolved + tickPlan.unmatchedExisting,
      snapshotShorter: snapshot.plays.length < input.previousPlays.length,
    };

    for (const play of identified.plays) {
      if (!input.firstObservedAt.has(play.reconciliationKey)) {
        input.firstObservedAt.set(play.reconciliationKey, localRequestTimestamp);
        newlyObservedThisTick.push({
          playKey: play.playKey,
          sequence: play.sequence,
          period: play.period,
          clock: play.clock,
          description: play.description,
          firstObservedAtLocal: localRequestTimestamp,
        });
      }
    }

    syntheticPlays = identified.plays.map((play) =>
      toSyntheticGamePlay(play, input.gameId, sourceUpdatedAt),
    );
  }

  const gameStateItem = gameState.value;

  const record: TickRecord = {
    type: 'tick',
    tickIndex: input.tickIndex,
    localRequestTimestamp,
    requestUsageDelta: deps.requestCounter.getRequestCount() - requestCountBefore,
    rateLimitObservation: deps.rateLimitObservation(),
    gameState: {
      outcome: gameState.outcome,
      internalStatusBefore,
      providerStatus: gameStateItem?.providerSnapshot?.status ?? null,
      homeScore: gameStateItem?.providerSnapshot?.homeScore ?? null,
      awayScore: gameStateItem?.providerSnapshot?.awayScore ?? null,
      period: gameStateItem?.providerSnapshot?.quarter ?? null,
      clock: gameStateItem?.providerSnapshot?.clock ?? null,
    },
    teamStats: {
      outcome: teamStatsOutcome,
      classification: teamStatsCoverage?.classification ?? null,
      rowCount: teamStatsCoverage?.rowCount ?? null,
      orientationValid: teamStatsCoverage?.orientationValid ?? null,
      nonNullFieldCount:
        teamStatsCoverage === null
          ? null
          : Object.values(teamStatsCoverage.fields).reduce(
              (total, field) => total + field.nonNull,
              0,
            ),
      totalFieldSlots:
        teamStatsCoverage === null
          ? null
          : Object.values(teamStatsCoverage.fields).reduce(
              (total, field) => total + field.total,
              0,
            ),
    },
    plays: {
      outcome: playsOutcome,
      providerPlayDetailsCount,
      normalizedPlayCount,
      unresolvedPossession,
      unknownPlayTypes,
      fieldPositionFailures,
      vsStoredDb,
      vsPreviousTick,
      newlyObservedThisTick,
    },
  };

  return { record, syntheticPlays };
}

async function withOutcome<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T | null; readonly outcome: RequestOutcome }> {
  const started = performance.now();
  try {
    const value = await operation();
    return {
      value,
      outcome: {
        ok: true,
        attempted: true,
        durationMs: rounded(performance.now() - started),
        errorCategory: null,
        errorMessage: null,
      },
    };
  } catch (error: unknown) {
    const classified = classifyError(error);
    return {
      value: null,
      outcome: {
        ok: false,
        attempted: true,
        durationMs: rounded(performance.now() - started),
        errorCategory: classified.category,
        errorMessage: classified.message,
      },
    };
  }
}

function classifyError(error: unknown): { readonly category: string; readonly message: string } {
  if (error instanceof HighlightlyEvaluationError) {
    return { category: error.code, message: error.message };
  }
  if (error instanceof CurrentGameSyncError) {
    return { category: error.code, message: error.message };
  }
  if (error instanceof Error) return { category: 'OTHER', message: error.message };
  return { category: 'OTHER', message: 'Unknown error.' };
}

function toSyntheticGamePlay(play: IdentifiedPlay, gameId: string, timestamp: Date): GamePlay {
  const { fullSignature: _full, structuralSignature: _structural, ...row } = play;
  void _full;
  void _structural;
  return {
    ...row,
    id: `synthetic:${play.reconciliationKey}`,
    gameId,
    sourceUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonical(left) === canonical(right);
}
