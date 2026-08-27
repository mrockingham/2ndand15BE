import { describe, expect, it } from 'vitest';

import {
  classifyFeatured,
  decideScheduling,
  type SchedulingGameInput,
  type SchedulingPolicyConfig,
  type SchedulingPollStateInput,
} from './current-game-scheduling.js';

const now = new Date('2026-08-23T00:00:00.000Z');

const config: SchedulingPolicyConfig = {
  pregamePollSeconds: 300,
  livePollSeconds: 120,
  featuredPollSeconds: 60,
  halftimePollSeconds: 180,
  finalReconcile10Minutes: 10,
  finalReconcile60Minutes: 60,
};

const noFinalHistory: SchedulingPollStateInput = {
  finalObservedAt: null,
  finalImmediateCompletedAt: null,
  final10CompletedAt: null,
  final60CompletedAt: null,
};

function game(overrides: Partial<SchedulingGameInput> = {}): SchedulingGameInput {
  return {
    status: 'IN_PROGRESS',
    startTime: now,
    quarter: null,
    homeScore: null,
    awayScore: null,
    manualFeatured: null,
    broadcastNetwork: null,
    ...overrides,
  };
}

describe('classifyFeatured', () => {
  it('is not featured by default', () => {
    expect(classifyFeatured(game())).toEqual({ featured: false, reason: null });
  });

  it('honors a manual featured override', () => {
    expect(classifyFeatured(game({ manualFeatured: true }))).toEqual({
      featured: true,
      reason: 'MANUAL',
    });
  });

  it('honors a manual un-featured override even over national broadcast', () => {
    expect(classifyFeatured(game({ manualFeatured: false, broadcastNetwork: 'NBC' }))).toEqual({
      featured: false,
      reason: null,
    });
  });

  it('treats NBC/ESPN/NFL Network/Prime Video/Netflix/ABC as national', () => {
    for (const network of ['NBC', 'ESPN', 'NFL Network', 'Prime Video', 'Netflix', 'ABC']) {
      expect(classifyFeatured(game({ broadcastNetwork: network }))).toEqual({
        featured: true,
        reason: 'NATIONAL_BROADCAST',
      });
    }
  });

  it('does not treat FOX or CBS as national (regional Sunday package)', () => {
    expect(classifyFeatured(game({ broadcastNetwork: 'FOX' }))).toEqual({
      featured: false,
      reason: null,
    });
    expect(classifyFeatured(game({ broadcastNetwork: 'CBS' }))).toEqual({
      featured: false,
      reason: null,
    });
  });

  it('features a one-score fourth quarter game', () => {
    expect(classifyFeatured(game({ quarter: 4, homeScore: 20, awayScore: 14 }))).toEqual({
      featured: true,
      reason: 'CLOSE_Q4',
    });
  });

  it('features an exact 8-point fourth quarter game (boundary)', () => {
    expect(classifyFeatured(game({ quarter: 4, homeScore: 20, awayScore: 12 }))).toEqual({
      featured: true,
      reason: 'CLOSE_Q4',
    });
  });

  it('does not feature a two-score (>8) fourth quarter game', () => {
    expect(classifyFeatured(game({ quarter: 4, homeScore: 21, awayScore: 12 }))).toEqual({
      featured: false,
      reason: null,
    });
  });

  it('does not apply the close-game rule outside the fourth quarter', () => {
    expect(classifyFeatured(game({ quarter: 3, homeScore: 20, awayScore: 14 }))).toEqual({
      featured: false,
      reason: null,
    });
  });

  it('does not apply the close-game rule when a score is missing', () => {
    expect(classifyFeatured(game({ quarter: 4, homeScore: 20, awayScore: null }))).toEqual({
      featured: false,
      reason: null,
    });
  });
});

describe('decideScheduling: pregame', () => {
  it('is not due more than 10 minutes before kickoff, and schedules the wake at T-10', () => {
    const startTime = new Date(now.getTime() + 30 * 60_000);
    const decision = decideScheduling(
      game({ status: 'SCHEDULED', startTime }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('NOT_DUE');
    expect(decision.nextPollAt).toEqual(new Date(startTime.getTime() - 10 * 60_000));
  });

  it('polls every 300 seconds inside the 10-minute pregame window', () => {
    const startTime = new Date(now.getTime() + 9 * 60_000);
    const decision = decideScheduling(
      game({ status: 'PREGAME', startTime }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('PREGAME');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 300_000));
  });

  it('is not a candidate when the reviewed kickoff is unknown', () => {
    const decision = decideScheduling(
      game({ status: 'SCHEDULED', startTime: null }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision).toEqual({
      schedulingClass: 'NOT_DUE',
      featuredReason: null,
      nextPollAt: null,
    });
  });
});

describe('decideScheduling: live', () => {
  it('polls a normal live game every 120 seconds', () => {
    const decision = decideScheduling(game({ status: 'IN_PROGRESS' }), noFinalHistory, now, config);
    expect(decision.schedulingClass).toBe('LIVE_NORMAL');
    expect(decision.featuredReason).toBeNull();
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 120_000));
  });

  it('polls a manually featured live game every 60 seconds', () => {
    const decision = decideScheduling(
      game({ status: 'IN_PROGRESS', manualFeatured: true }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('LIVE_FEATURED');
    expect(decision.featuredReason).toBe('MANUAL');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it('polls a nationally broadcast live game every 60 seconds', () => {
    const decision = decideScheduling(
      game({ status: 'IN_PROGRESS', broadcastNetwork: 'ESPN' }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('LIVE_FEATURED');
    expect(decision.featuredReason).toBe('NATIONAL_BROADCAST');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it('polls a one-score fourth quarter game every 60 seconds', () => {
    const decision = decideScheduling(
      game({ status: 'IN_PROGRESS', quarter: 4, homeScore: 24, awayScore: 20 }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('LIVE_FEATURED');
    expect(decision.featuredReason).toBe('CLOSE_Q4');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it('polls a two-score fourth quarter game every 120 seconds (drops back to normal)', () => {
    const decision = decideScheduling(
      game({ status: 'IN_PROGRESS', quarter: 4, homeScore: 30, awayScore: 10 }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('LIVE_NORMAL');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 120_000));
  });

  it('polls halftime every 180 seconds regardless of featured rules', () => {
    const decision = decideScheduling(
      game({ status: 'HALFTIME', broadcastNetwork: 'ESPN' }),
      noFinalHistory,
      now,
      config,
    );
    expect(decision.schedulingClass).toBe('HALFTIME');
    expect(decision.nextPollAt).toEqual(new Date(now.getTime() + 180_000));
  });
});

describe('decideScheduling: final reconciliation', () => {
  it('is immediately due the first time FINAL is observed', () => {
    const decision = decideScheduling(game({ status: 'FINAL' }), noFinalHistory, now, config);
    expect(decision).toEqual({
      schedulingClass: 'FINAL_IMMEDIATE',
      featuredReason: null,
      nextPollAt: now,
    });
  });

  it('schedules the +10 minute reconciliation once the immediate pass completes', () => {
    const finalObservedAt = new Date(now.getTime() - 60_000);
    const decision = decideScheduling(
      game({ status: 'FINAL' }),
      { ...noFinalHistory, finalObservedAt, finalImmediateCompletedAt: finalObservedAt },
      now,
      config,
    );
    expect(decision).toEqual({
      schedulingClass: 'FINAL_RECONCILE_10',
      featuredReason: null,
      nextPollAt: new Date(finalObservedAt.getTime() + 10 * 60_000),
    });
  });

  it('schedules the +60 minute reconciliation once +10 completes', () => {
    const finalObservedAt = new Date(now.getTime() - 11 * 60_000);
    const decision = decideScheduling(
      game({ status: 'FINAL' }),
      {
        finalObservedAt,
        finalImmediateCompletedAt: finalObservedAt,
        final10CompletedAt: now,
        final60CompletedAt: null,
      },
      now,
      config,
    );
    expect(decision).toEqual({
      schedulingClass: 'FINAL_RECONCILE_60',
      featuredReason: null,
      nextPollAt: new Date(finalObservedAt.getTime() + 60 * 60_000),
    });
  });

  it('is COMPLETE with no further polling once +60 completes', () => {
    const finalObservedAt = new Date(now.getTime() - 61 * 60_000);
    const decision = decideScheduling(
      game({ status: 'FINAL' }),
      {
        finalObservedAt,
        finalImmediateCompletedAt: finalObservedAt,
        final10CompletedAt: now,
        final60CompletedAt: now,
      },
      now,
      config,
    );
    expect(decision).toEqual({
      schedulingClass: 'COMPLETE',
      featuredReason: null,
      nextPollAt: null,
    });
  });
});

describe('decideScheduling: terminal non-final statuses', () => {
  it('is not a candidate for POSTPONED/CANCELED/SUSPENDED games', () => {
    for (const status of ['POSTPONED', 'CANCELED', 'SUSPENDED'] as const) {
      expect(decideScheduling(game({ status }), noFinalHistory, now, config)).toEqual({
        schedulingClass: 'NOT_DUE',
        featuredReason: null,
        nextPollAt: null,
      });
    }
  });
});
