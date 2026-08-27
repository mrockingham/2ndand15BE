import type { CurrentGameTeamStat } from '../../generated/prisma/client.js';
import {
  classifyCurrentGameTeamStats,
  type CurrentGameTeamStatCoverage,
} from './current-game-team-stat-coverage.js';
import {
  toTeamStatWrite,
  type CurrentGameDetailsRepository,
  type CurrentGameTeamStatWrite,
} from './current-game-details.repository.js';
import type { CurrentGamePlayRepository } from './current-game-play.repository.js';
import {
  decideScheduling,
  type SchedulingGameInput,
  type SchedulingPolicyConfig,
} from './current-game-scheduling.js';
import {
  classifyPlaysBlockReason,
  derivePlaysBlockState,
  type PlaysBlockState,
} from './current-game-play-block-state.js';
import type {
  FinalPlaySnapshotService,
  FinalReplacementPhase,
} from './current-game-play-final-replacement.js';
import { identifyPlays, reconcilePlays } from './sync-current-game-plays.js';
import {
  CurrentGameSyncError,
  type CurrentGameExecutionPolicy,
  type CurrentGameSyncService,
} from './sync-current-games.js';
import { HighlightlyEvaluationError } from './evaluation/highlightly/highlightly-http-client.js';
import type { MatchDetailFetcher } from './live-game-validation.js';
import { normalizeHighlightlyCurrentGamePlays } from './providers/highlightly/highlightly-current-game-play-provider.js';
import { normalizeHighlightlyCurrentGameDetails } from './providers/highlightly/highlightly-current-game-details-provider.js';
import type {
  ClaimedPoll,
  CurrentGamePollStateRepository,
  PollCandidateGame,
} from './current-game-poll-state.repository.js';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

/**
 * M31A: the one method the poller needs from `GameHighlightsService`, defined
 * locally so `sports/` never imports from the `game-highlights/` domain module
 * (matching every other cross-module boundary here -- `MatchDetailFetcher`,
 * `CurrentGameSyncService`, etc. are all narrow ports defined at the point of
 * use). A real `GameHighlightsService` instance satisfies this structurally.
 */
export interface HighlightSyncPort {
  syncGame(
    gameId: string,
    options?: { readonly exhaustiveCheck?: boolean },
  ): Promise<{ readonly coverage: string; readonly errorCode: string | null }>;
}

export interface CurrentGamePollerDependencies {
  readonly gameSyncService: CurrentGameSyncService;
  readonly detailsRepository: CurrentGameDetailsRepository;
  readonly playRepository: CurrentGamePlayRepository;
  readonly finalPlaySnapshotService: FinalPlaySnapshotService;
  readonly matchDetailFetcher: MatchDetailFetcher;
  readonly highlightsService: HighlightSyncPort;
  readonly pollStateRepository: CurrentGamePollStateRepository;
  readonly requestCounter: { getRequestCount(): number };
  readonly rateLimitObservation: () => {
    readonly limit: number | null;
    readonly remaining: number | null;
  };
  readonly now: () => Date;
  readonly workerId: string;
}

export interface CurrentGamePollerOptions {
  readonly schedulingConfig: SchedulingPolicyConfig;
  readonly policy: CurrentGameExecutionPolicy;
  readonly lockLeaseSeconds: number;
  readonly batchSize: number;
  readonly rateLimitDegradeThreshold: number;
  readonly onlyGameId?: string;
  readonly dryRun?: boolean;
}

export interface GameTickReport {
  readonly gameId: string;
  readonly schedulingClassBefore: string;
  readonly schedulingClassAfter: string;
  readonly featuredReason: string | null;
  readonly nextPollAt: string | null;
  readonly requestUsageDelta: number;
  readonly gameState: {
    readonly ok: boolean;
    readonly outcome: string | null;
    readonly errorMessage: string | null;
  };
  readonly teamStats: {
    readonly attempted: boolean;
    readonly ok: boolean;
    readonly classification: CurrentGameTeamStatCoverage['classification'] | null;
    readonly errorMessage: string | null;
  };
  readonly plays: {
    readonly attempted: boolean;
    readonly ok: boolean;
    readonly providerPlayCount: number | null;
    readonly inserted: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly storedTotal: number | null;
    readonly blocked: boolean;
    readonly blockReason: string | null;
    readonly errorMessage: string | null;
    /** M27.2: non-null only on a FINAL tick — which authoritative-replacement outcome occurred. */
    readonly finalReplacementStatus:
      'REPLACED' | 'NOOP_UNCHANGED' | 'VALIDATION_FAILED' | 'FAILED' | null;
  };
  /**
   * M31A: attempted only on a FINAL_IMMEDIATE/FINAL_RECONCILE_10/FINAL_RECONCILE_60
   * tick. Deliberately excluded from `overallOk`/the retry-with-backoff decision
   * below -- a highlight failure must never block `finalImmediateCompletedAt`/
   * `final10CompletedAt`/`final60CompletedAt` from advancing, or the FINAL
   * lifecycle (and eventually poll completion) would stall on it.
   */
  readonly highlights: {
    readonly attempted: boolean;
    readonly ok: boolean;
    readonly coverage: string | null;
    readonly errorMessage: string | null;
  };
  readonly durationMs: number;
  readonly degraded: boolean;
}

export interface DryRunCandidatePreview {
  readonly gameId: string;
  readonly status: SchedulingGameInput['status'];
  readonly schedulingClass: string;
  readonly featuredReason: string | null;
  readonly expectedIntervalSeconds: number | null;
  readonly nextPollAt: string | null;
}

export interface PollerCycleReport {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly candidatesDiscovered: number;
  readonly claimed: number;
  readonly ticks: readonly GameTickReport[];
  readonly rateLimitObservation: {
    readonly limit: number | null;
    readonly remaining: number | null;
  };
  readonly degraded: boolean;
  /** Populated only for `dryRun: true` — a read-only scheduling preview, no writes. */
  readonly dryRunPreview: readonly DryRunCandidatePreview[] | null;
}

export class CurrentGamePoller {
  constructor(private readonly deps: CurrentGamePollerDependencies) {}

  async runCycle(options: CurrentGamePollerOptions): Promise<PollerCycleReport> {
    const startedAt = this.deps.now();
    const cycleStarted = performance.now();
    const discovered = await this.deps.pollStateRepository.discoverCandidates(startedAt);
    const inScope =
      options.onlyGameId === undefined
        ? discovered
        : discovered.filter((candidate) => candidate.gameId === options.onlyGameId);
    let dryRunPreview: readonly DryRunCandidatePreview[] | null = null;
    if (options.dryRun !== true) {
      await this.deps.pollStateRepository.ensurePollStates(
        inScope.map((candidate) => candidate.gameId),
        startedAt,
      );
    } else {
      // Read-only preview: no poll-state row is created or persisted for this candidate.
      const noPriorHistory = {
        finalObservedAt: null,
        finalImmediateCompletedAt: null,
        final10CompletedAt: null,
        final60CompletedAt: null,
      };
      dryRunPreview = inScope.map((candidate) => {
        const input = toSchedulingInput(candidate);
        const decision = decideScheduling(
          input,
          noPriorHistory,
          startedAt,
          options.schedulingConfig,
        );
        return {
          gameId: candidate.gameId,
          status: candidate.status,
          schedulingClass: decision.schedulingClass,
          featuredReason: decision.featuredReason,
          expectedIntervalSeconds:
            decision.nextPollAt === null
              ? null
              : Math.round((decision.nextPollAt.getTime() - startedAt.getTime()) / 1_000),
          nextPollAt: decision.nextPollAt?.toISOString() ?? null,
        };
      });
    }

    const rateLimit = this.deps.rateLimitObservation();
    const degraded =
      rateLimit.remaining !== null && rateLimit.remaining < options.rateLimitDegradeThreshold;

    const claimed =
      options.dryRun === true
        ? []
        : await this.deps.pollStateRepository.claimDue(
            startedAt,
            this.deps.workerId,
            options.lockLeaseSeconds * 1_000,
            options.batchSize,
          );
    const eligible = degraded ? claimed.filter((poll) => shouldPollWhileDegraded(poll)) : claimed;

    const ticks: GameTickReport[] = [];
    for (const claim of eligible) {
      ticks.push(await this.executeTick(claim, options));
    }
    // Release any claims skipped for degradation without penalizing their schedule.
    for (const claim of claimed) {
      if (eligible.includes(claim)) continue;
      await this.deps.pollStateRepository.recordFailure(
        claim.pollState.id,
        this.deps.now(),
        'Skipped: rate-limit quota degradation policy',
        claim.pollState.nextPollAt ?? this.deps.now(),
        {
          playsBlockedAt: claim.pollState.playsBlockedAt,
          playsBlockReason: claim.pollState.playsBlockReason,
          playsReviewRequired: claim.pollState.playsReviewRequired,
        },
      );
    }

    return {
      startedAt: startedAt.toISOString(),
      durationMs: rounded(performance.now() - cycleStarted),
      candidatesDiscovered: inScope.length,
      claimed: claimed.length,
      ticks,
      rateLimitObservation: rateLimit,
      degraded,
      dryRunPreview,
    };
  }

  private async executeTick(
    claim: ClaimedPoll,
    options: CurrentGamePollerOptions,
  ): Promise<GameTickReport> {
    const started = performance.now();
    const requestsBefore = this.deps.requestCounter.getRequestCount();
    const now = this.deps.now();
    const { pollState, game } = claim;

    let gameStateOk = true;
    let gameStateOutcome: string | null = null;
    let gameStateError: string | null = null;
    let observedGame: SchedulingGameInput = toSchedulingInput(game);
    let providerGameId = game.providerMapping?.providerGameId ?? null;
    // Preserved by default: a tick that never reaches (or fails before) play reconciliation must
    // not disturb the durable block state from a previous tick.
    let playsBlockState: PlaysBlockState = {
      playsBlockedAt: pollState.playsBlockedAt,
      playsBlockReason: pollState.playsBlockReason,
      playsReviewRequired: pollState.playsReviewRequired,
    };

    try {
      const report = await this.deps.gameSyncService.sync({
        gameId: game.gameId,
        apply: true,
        policy: options.policy,
      });
      const item = report.results[0];
      gameStateOutcome = item?.outcome ?? null;
      if (item?.providerGameId !== null && item?.providerGameId !== undefined) {
        providerGameId = item.providerGameId;
      }
      if (
        item?.providerSnapshot !== null &&
        item?.providerSnapshot !== undefined &&
        ['UPDATED', 'UNCHANGED', 'WOULD_UPDATE'].includes(item.outcome)
      ) {
        observedGame = {
          status: item.providerSnapshot.status,
          startTime: game.startTime,
          quarter: item.providerSnapshot.quarter,
          homeScore: item.providerSnapshot.homeScore,
          awayScore: item.providerSnapshot.awayScore,
          manualFeatured: game.manualFeatured,
          broadcastNetwork: item.providerSnapshot.broadcastNetwork ?? game.broadcastNetwork,
        };
      }
    } catch (error: unknown) {
      gameStateOk = false;
      gameStateError = errorMessage(error);
    }

    // Computed early (moved up from the bottom of this method) so the plays section below can
    // derive which FINAL replacement phase this tick is, in addition to its original use in the
    // scheduling decision at the bottom. Pure reordering — no change to game-state/scheduling.
    const finalTransition = computeFinalTransition(observedGame.status, pollState, now);
    const finalReplacementPhase = finalReplacementPhaseFor(finalTransition.pollStateUpdate);

    const teamStats: Mutable<GameTickReport['teamStats']> = {
      attempted: false,
      ok: true,
      classification: null,
      errorMessage: null,
    };
    const plays: Mutable<GameTickReport['plays']> = {
      attempted: false,
      ok: true,
      providerPlayCount: null,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      storedTotal: null,
      blocked: false,
      blockReason: null,
      errorMessage: null,
      finalReplacementStatus: null,
    };
    const highlights: Mutable<GameTickReport['highlights']> = {
      attempted: false,
      ok: true,
      coverage: null,
      errorMessage: null,
    };

    if (providerGameId !== null) {
      const detailFetch = await this.deps.matchDetailFetcher.fetch(providerGameId);
      if (detailFetch.detail === null) {
        const reason = detailFetch.failureReason ?? 'Match detail was unavailable.';
        teamStats.attempted = true;
        teamStats.ok = false;
        teamStats.errorMessage = reason;
        plays.attempted = true;
        plays.ok = false;
        plays.errorMessage = reason;
      } else {
        const detail = detailFetch.detail;
        teamStats.attempted = true;
        try {
          const normalized = normalizeHighlightlyCurrentGameDetails(
            detail,
            [],
            providerGameId,
            false,
          );
          const target = await this.deps.detailsRepository.findTarget(game.gameId, 'highlightly');
          if (target === null) throw new Error('Internal game was not found for team-stat write.');
          if (
            !sameAbbreviation(normalized.homeAbbreviation, target.homeAbbreviation) ||
            !sameAbbreviation(normalized.awayAbbreviation, target.awayAbbreviation)
          ) {
            throw new Error(
              'Provider details conflict with the verified game identity or orientation.',
            );
          }
          const sourceUpdatedAt = now;
          const rows = [
            toTeamStatWrite({
              gameId: target.id,
              teamId: target.homeTeamId,
              isHome: true,
              stats: normalized.homeTeamStats,
              periods: normalized.homePeriodScores,
              provider: 'highlightly',
              sourceUpdatedAt,
            }),
            toTeamStatWrite({
              gameId: target.id,
              teamId: target.awayTeamId,
              isHome: false,
              stats: normalized.awayTeamStats,
              periods: normalized.awayPeriodScores,
              provider: 'highlightly',
              sourceUpdatedAt,
            }),
          ];
          teamStats.classification = classifyCurrentGameTeamStats({
            rows,
            homeTeamId: target.homeTeamId,
            awayTeamId: target.awayTeamId,
          }).classification;
          const changedRows = rows.filter((row) => rowChanged(row, target.teamStats));
          if (changedRows.length > 0 && options.dryRun !== true) {
            await this.deps.detailsRepository.applyStats({
              target,
              rows: changedRows,
              provider: 'highlightly',
              usageMode: options.policy.publicationApproved ? 'approved' : 'evaluation',
              unmatchedPlayerCount: 0,
            });
          }
        } catch (error: unknown) {
          teamStats.ok = false;
          teamStats.errorMessage = errorMessage(error);
        }

        plays.attempted = true;
        const playsSnapshot = normalizeHighlightlyCurrentGamePlays(detail, providerGameId);
        plays.providerPlayCount = playsSnapshot.plays.length;

        if (observedGame.status === 'FINAL' && finalReplacementPhase !== null) {
          // FINAL: the snapshot is authoritative — replace, never reconcile. See
          // current-game-play-final-replacement.ts. LIVE/HALFTIME below is unchanged.
          try {
            if (options.dryRun !== true) {
              const result = await this.deps.finalPlaySnapshotService.replace({
                gameId: game.gameId,
                phase: finalReplacementPhase,
                actorEmailSnapshot: 'current-game-poller',
                playsSnapshot,
              });
              plays.finalReplacementStatus = result.status;
              if (result.status === 'REPLACED') {
                plays.inserted = result.newActiveCount;
                plays.storedTotal = result.newActiveCount;
                playsBlockState = {
                  playsBlockedAt: null,
                  playsBlockReason: null,
                  playsReviewRequired: false,
                };
              } else if (result.status === 'NOOP_UNCHANGED') {
                plays.unchanged = result.activeCount;
                plays.storedTotal = result.activeCount;
                playsBlockState = {
                  playsBlockedAt: null,
                  playsBlockReason: null,
                  playsReviewRequired: false,
                };
              } else {
                plays.blocked = true;
                plays.blockReason = result.reasonCode;
                playsBlockState = derivePlaysBlockState(pollState, true, result.reasonCode, now);
              }
            }
          } catch (error: unknown) {
            // A thrown exception here is the transaction itself failing (not a validation
            // rejection, which `replace()` returns as a normal result) — a genuine failure, so
            // unlike a validation block this goes through recordFailure's retry path.
            plays.ok = false;
            plays.finalReplacementStatus = 'FAILED';
            plays.errorMessage = errorMessage(error);
            playsBlockState = derivePlaysBlockState(
              pollState,
              true,
              'FINAL_REPLACEMENT_FAILED',
              now,
            );
          }
        } else {
          try {
            const playTarget = await this.deps.playRepository.findTarget(
              game.gameId,
              'highlightly',
            );
            if (playTarget === null) throw new Error('Internal game was not found for play write.');
            if (
              !sameAbbreviation(playsSnapshot.homeAbbreviation, playTarget.homeAbbreviation) ||
              !sameAbbreviation(playsSnapshot.awayAbbreviation, playTarget.awayAbbreviation)
            ) {
              throw new Error(
                'Provider plays conflict with the verified game identity or orientation.',
              );
            }
            const identified = identifyPlays(
              game.gameId,
              'highlightly',
              playsSnapshot.plays,
              playsSnapshot,
              playTarget,
            );
            const sourceUpdatedAt =
              playsSnapshot.providerUpdatedAt === null
                ? now
                : new Date(playsSnapshot.providerUpdatedAt);
            const plan = reconcilePlays(identified.plays, playTarget.plays, sourceUpdatedAt);
            const blocked = plan.collisions > 0 || plan.unmatchedExisting > 0;
            const blockReasonCode = classifyPlaysBlockReason(
              plan.collisions,
              plan.unmatchedExisting,
            );
            playsBlockState = derivePlaysBlockState(pollState, blocked, blockReasonCode, now);
            plays.inserted = plan.inserted;
            plays.updated = plan.updated;
            plays.unchanged = plan.unchanged;
            plays.blocked = blocked;
            plays.blockReason = blockReasonCode;
            plays.storedTotal = playTarget.plays.length;
            if (!blocked && (plan.inserted > 0 || plan.updated > 0) && options.dryRun !== true) {
              await this.deps.playRepository.applySnapshot({
                target: playTarget,
                rows: plan.rows,
                provider: 'highlightly',
                usageMode: options.policy.publicationApproved ? 'approved' : 'evaluation',
                inserted: plan.inserted,
                updated: plan.updated,
              });
              plays.storedTotal = playTarget.plays.length + plan.inserted;
            }
          } catch (error: unknown) {
            plays.ok = false;
            plays.errorMessage = errorMessage(error);
          }
        }
      }

      // M31A: highlight sync is a fully independent step -- a separate Highlightly
      // endpoint, unrelated to match-detail success -- attempted exactly once per
      // FINAL reconciliation stage (never during LIVE/PREGAME/HALFTIME). It is
      // deliberately excluded from `overallOk` below: a highlight failure must
      // never block game-state/team-stat/play reconciliation, never trigger the
      // retry-with-backoff path below, and never prevent `finalImmediateCompletedAt`/
      // `final10CompletedAt`/`final60CompletedAt` from advancing -- the FINAL
      // lifecycle itself is what naturally retries a failed or not-yet-available
      // highlight check at the next stage.
      if (observedGame.status === 'FINAL' && finalReplacementPhase !== null) {
        highlights.attempted = true;
        try {
          if (options.dryRun !== true) {
            const result = await this.deps.highlightsService.syncGame(game.gameId, {
              exhaustiveCheck: finalReplacementPhase === 'FINAL_60',
            });
            highlights.coverage = result.coverage;
            if (result.coverage === 'PROVIDER_ERROR') {
              highlights.ok = false;
              highlights.errorMessage = result.errorCode;
            }
          }
        } catch (error: unknown) {
          highlights.ok = false;
          highlights.errorMessage = errorMessage(error);
        }
      }
    }

    const overallOk = gameStateOk && teamStats.ok && plays.ok;
    const decision = decideScheduling(
      observedGame,
      { ...pollState, ...finalTransition.pollStateUpdate },
      now,
      options.schedulingConfig,
    );

    if (options.dryRun !== true) {
      if (overallOk) {
        await this.deps.pollStateRepository.recordSuccess(pollState.id, now, {
          schedulingClass: decision.schedulingClass,
          featuredReason: decision.featuredReason,
          nextPollAt: decision.nextPollAt,
          lastObservedStatus: observedGame.status,
          ...finalTransition.pollStateUpdate,
          playsBlock: playsBlockState,
        });
      } else {
        const retryDelaySeconds = Math.min(
          options.schedulingConfig.livePollSeconds,
          options.schedulingConfig.pregamePollSeconds,
        );
        await this.deps.pollStateRepository.recordFailure(
          pollState.id,
          now,
          [gameStateError, teamStats.errorMessage, plays.errorMessage].filter(Boolean).join(' | '),
          new Date(now.getTime() + retryDelaySeconds * 1_000),
          playsBlockState,
        );
      }
    }

    return {
      gameId: game.gameId,
      schedulingClassBefore: pollState.schedulingClass,
      schedulingClassAfter: decision.schedulingClass,
      featuredReason: decision.featuredReason,
      nextPollAt: decision.nextPollAt?.toISOString() ?? null,
      requestUsageDelta: this.deps.requestCounter.getRequestCount() - requestsBefore,
      gameState: { ok: gameStateOk, outcome: gameStateOutcome, errorMessage: gameStateError },
      teamStats,
      plays,
      highlights,
      durationMs: rounded(performance.now() - started),
      degraded: false,
    };
  }
}

function computeFinalTransition(
  status: SchedulingGameInput['status'],
  pollState: ClaimedPoll['pollState'],
  now: Date,
): {
  readonly pollStateUpdate: Partial<{
    finalObservedAt: Date;
    finalImmediateCompletedAt: Date;
    final10CompletedAt: Date;
    final60CompletedAt: Date;
  }>;
} {
  if (status !== 'FINAL') return { pollStateUpdate: {} };
  if (pollState.finalImmediateCompletedAt === null) {
    return {
      pollStateUpdate: {
        finalObservedAt: pollState.finalObservedAt ?? now,
        finalImmediateCompletedAt: now,
      },
    };
  }
  if (pollState.final10CompletedAt === null && pollState.schedulingClass === 'FINAL_RECONCILE_10') {
    return { pollStateUpdate: { final10CompletedAt: now } };
  }
  if (pollState.final60CompletedAt === null && pollState.schedulingClass === 'FINAL_RECONCILE_60') {
    return { pollStateUpdate: { final60CompletedAt: now } };
  }
  return { pollStateUpdate: {} };
}

/** Which FINAL replacement pass this tick is, derived from the same transition computed above —
 * `null` means this tick has nothing new to do for plays (e.g. a stray poll after COMPLETE). */
function finalReplacementPhaseFor(
  pollStateUpdate: ReturnType<typeof computeFinalTransition>['pollStateUpdate'],
): FinalReplacementPhase | null {
  if (pollStateUpdate.finalImmediateCompletedAt !== undefined) return 'FINAL_IMMEDIATE';
  if (pollStateUpdate.final10CompletedAt !== undefined) return 'FINAL_10';
  if (pollStateUpdate.final60CompletedAt !== undefined) return 'FINAL_60';
  return null;
}

function toSchedulingInput(game: PollCandidateGame): SchedulingGameInput {
  return {
    status: game.status,
    startTime: game.startTime,
    quarter: game.quarter,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    manualFeatured: game.manualFeatured,
    broadcastNetwork: game.broadcastNetwork,
  };
}

/**
 * While rate-limit quota is degraded: preserve FINAL reconciliation and featured games first.
 * `NOT_DUE` is also always allowed through — it only appears on a poll-state row's very first
 * claim, before it has ever been classified (discovery excludes postponed/canceled/suspended
 * and pre-window pregame games, so decideScheduling never re-emits NOT_DUE for anything the
 * claim pipeline would surface a second time). Skipping a game's first-ever classification
 * would leave it stuck with no scheduling decision at all.
 */
export function shouldPollWhileDegraded(claim: ClaimedPoll): boolean {
  return (
    claim.pollState.schedulingClass === 'NOT_DUE' ||
    claim.pollState.schedulingClass === 'FINAL_IMMEDIATE' ||
    claim.pollState.schedulingClass === 'FINAL_RECONCILE_10' ||
    claim.pollState.schedulingClass === 'FINAL_RECONCILE_60' ||
    claim.pollState.schedulingClass === 'LIVE_FEATURED'
  );
}

function rowChanged(
  row: CurrentGameTeamStatWrite,
  existing: readonly CurrentGameTeamStat[],
): boolean {
  const match = existing.find((candidate) => candidate.teamId === row.teamId);
  if (match === undefined) return true;
  return (Object.keys(row) as (keyof CurrentGameTeamStatWrite)[]).some(
    (key) => key !== 'gameId' && match[key as keyof CurrentGameTeamStat] !== row[key],
  );
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonical(left) === canonical(right);
}

function errorMessage(error: unknown): string {
  if (error instanceof HighlightlyEvaluationError) return `${error.code}: ${error.message}`;
  if (error instanceof CurrentGameSyncError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'Unknown poller error.';
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
