import type { GameSchedulingClass, GameStatus } from '../../generated/prisma/client.js';
import { isNationalBroadcast } from './national-broadcast-networks.js';

export type { GameSchedulingClass };

export type FeaturedReason = 'MANUAL' | 'NATIONAL_BROADCAST' | 'CLOSE_Q4';

export const PREGAME_LEAD_MINUTES = 10;

export interface SchedulingPolicyConfig {
  readonly pregamePollSeconds: number;
  readonly livePollSeconds: number;
  readonly featuredPollSeconds: number;
  readonly halftimePollSeconds: number;
  readonly finalReconcile10Minutes: number;
  readonly finalReconcile60Minutes: number;
}

export interface SchedulingGameInput {
  readonly status: GameStatus;
  readonly startTime: Date | null;
  readonly quarter: number | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly manualFeatured: boolean | null;
  readonly broadcastNetwork: string | null;
}

export interface SchedulingPollStateInput {
  readonly finalObservedAt: Date | null;
  readonly finalImmediateCompletedAt: Date | null;
  readonly final10CompletedAt: Date | null;
  readonly final60CompletedAt: Date | null;
}

export interface FeaturedDecision {
  readonly featured: boolean;
  readonly reason: FeaturedReason | null;
}

export interface SchedulingDecision {
  readonly schedulingClass: GameSchedulingClass;
  readonly featuredReason: FeaturedReason | null;
  /** When the next poll should occur for this class; null means never (COMPLETE / not a candidate). */
  readonly nextPollAt: Date | null;
}

/**
 * V1 featured rules, in precedence order: an explicit manual override (true or false) always
 * wins; otherwise national broadcast; otherwise a one-score (<=8) fourth quarter. Recalculated
 * every poll, so a game can enter and leave LIVE_FEATURED as the score/quarter changes.
 */
export function classifyFeatured(game: SchedulingGameInput): FeaturedDecision {
  if (game.manualFeatured === true) return { featured: true, reason: 'MANUAL' };
  if (game.manualFeatured === false) return { featured: false, reason: null };
  if (isNationalBroadcast(game.broadcastNetwork)) {
    return { featured: true, reason: 'NATIONAL_BROADCAST' };
  }
  if (
    game.quarter === 4 &&
    game.homeScore !== null &&
    game.awayScore !== null &&
    Math.abs(game.homeScore - game.awayScore) <= 8
  ) {
    return { featured: true, reason: 'CLOSE_Q4' };
  }
  return { featured: false, reason: null };
}

/**
 * Pure scheduling decision: given the freshest known game state, the durable final-reconciliation
 * flags, the current time, and configured intervals, decide which scheduling class the NEXT poll
 * belongs to and when it is due. Does not itself compare against "now" to say whether a stored
 * nextPollAt has elapsed — that comparison is the claim query's job (current-game-poll-state.repository.ts).
 * Callers re-run this after every completed poll to compute the following nextPollAt.
 */
export function decideScheduling(
  game: SchedulingGameInput,
  pollState: SchedulingPollStateInput,
  now: Date,
  config: SchedulingPolicyConfig,
): SchedulingDecision {
  if (game.status === 'FINAL') return decideFinalScheduling(pollState, now, config);

  if (game.status === 'HALFTIME') {
    return {
      schedulingClass: 'HALFTIME',
      featuredReason: null,
      nextPollAt: addSeconds(now, config.halftimePollSeconds),
    };
  }

  if (game.status === 'IN_PROGRESS') {
    const { featured, reason } = classifyFeatured(game);
    return {
      schedulingClass: featured ? 'LIVE_FEATURED' : 'LIVE_NORMAL',
      featuredReason: reason,
      nextPollAt: addSeconds(now, featured ? config.featuredPollSeconds : config.livePollSeconds),
    };
  }

  if (game.status === 'SCHEDULED' || game.status === 'PREGAME') {
    if (game.startTime === null) {
      return { schedulingClass: 'NOT_DUE', featuredReason: null, nextPollAt: null };
    }
    const pregameStart = new Date(game.startTime.getTime() - PREGAME_LEAD_MINUTES * 60_000);
    if (now < pregameStart) {
      return { schedulingClass: 'NOT_DUE', featuredReason: null, nextPollAt: pregameStart };
    }
    return {
      schedulingClass: 'PREGAME',
      featuredReason: null,
      nextPollAt: addSeconds(now, config.pregamePollSeconds),
    };
  }

  // POSTPONED / CANCELED / SUSPENDED: not a polling candidate.
  return { schedulingClass: 'NOT_DUE', featuredReason: null, nextPollAt: null };
}

function decideFinalScheduling(
  pollState: SchedulingPollStateInput,
  now: Date,
  config: SchedulingPolicyConfig,
): SchedulingDecision {
  if (pollState.finalImmediateCompletedAt === null) {
    return { schedulingClass: 'FINAL_IMMEDIATE', featuredReason: null, nextPollAt: now };
  }
  const finalObservedAt = pollState.finalObservedAt ?? now;
  if (pollState.final10CompletedAt === null) {
    return {
      schedulingClass: 'FINAL_RECONCILE_10',
      featuredReason: null,
      nextPollAt: addMinutes(finalObservedAt, config.finalReconcile10Minutes),
    };
  }
  if (pollState.final60CompletedAt === null) {
    return {
      schedulingClass: 'FINAL_RECONCILE_60',
      featuredReason: null,
      nextPollAt: addMinutes(finalObservedAt, config.finalReconcile60Minutes),
    };
  }
  return { schedulingClass: 'COMPLETE', featuredReason: null, nextPollAt: null };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
