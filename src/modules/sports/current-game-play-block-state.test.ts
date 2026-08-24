import { describe, expect, it } from 'vitest';

import {
  classifyPlaysBlockReason,
  derivePlaysBlockState,
  type PlaysBlockState,
} from './current-game-play-block-state.js';

const cleared: PlaysBlockState = {
  playsBlockedAt: null,
  playsBlockReason: null,
  playsReviewRequired: false,
};

describe('classifyPlaysBlockReason', () => {
  it('classifies zero counts as no reason', () => {
    expect(classifyPlaysBlockReason(0, 0)).toBeNull();
  });

  it('classifies a collision-only block', () => {
    expect(classifyPlaysBlockReason(2, 0)).toBe('COLLISION');
  });

  it('classifies an unmatched-only block', () => {
    expect(classifyPlaysBlockReason(0, 3)).toBe('UNMATCHED_EXISTING');
  });

  it('classifies a combined block', () => {
    expect(classifyPlaysBlockReason(1, 1)).toBe('COLLISION_AND_UNMATCHED');
  });
});

describe('derivePlaysBlockState', () => {
  it('clears every field when reconciliation is not blocked', () => {
    const previous: PlaysBlockState = {
      playsBlockedAt: new Date('2026-08-20T00:00:00Z'),
      playsBlockReason: 'COLLISION',
      playsReviewRequired: true,
    };
    expect(derivePlaysBlockState(previous, false, null, new Date('2026-08-23T00:00:00Z'))).toEqual(
      cleared,
    );
  });

  it('stamps playsBlockedAt on the first blocked occurrence', () => {
    const now = new Date('2026-08-23T00:00:00Z');
    expect(derivePlaysBlockState(cleared, true, 'UNMATCHED_EXISTING', now)).toEqual({
      playsBlockedAt: now,
      playsBlockReason: 'UNMATCHED_EXISTING',
      playsReviewRequired: true,
    });
  });

  it('preserves the original playsBlockedAt across repeat blocked occurrences while refreshing the reason', () => {
    const firstBlockedAt = new Date('2026-08-22T23:00:00Z');
    const previous: PlaysBlockState = {
      playsBlockedAt: firstBlockedAt,
      playsBlockReason: 'UNMATCHED_EXISTING',
      playsReviewRequired: true,
    };
    const later = new Date('2026-08-23T01:00:00Z');
    expect(derivePlaysBlockState(previous, true, 'COLLISION_AND_UNMATCHED', later)).toEqual({
      playsBlockedAt: firstBlockedAt,
      playsBlockReason: 'COLLISION_AND_UNMATCHED',
      playsReviewRequired: true,
    });
  });
});
