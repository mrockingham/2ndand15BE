/** Application-level reason code for a blocked plays reconciliation. Deliberately a closed,
 * capped code — never free text derived from provider content — so it can never leak provider
 * terms through `CurrentGamePollState.playsBlockReason`. `FINAL_SNAPSHOT_INVALID` and
 * `FINAL_REPLACEMENT_FAILED` (M27.2) cover the authoritative FINAL replacement path, passed in
 * directly rather than derived from `classifyPlaysBlockReason`. */
export type PlaysBlockReasonCode =
  | 'COLLISION'
  | 'UNMATCHED_EXISTING'
  | 'COLLISION_AND_UNMATCHED'
  | 'FINAL_SNAPSHOT_INVALID'
  | 'FINAL_REPLACEMENT_FAILED';

export interface PlaysBlockState {
  readonly playsBlockedAt: Date | null;
  readonly playsBlockReason: string | null;
  readonly playsReviewRequired: boolean;
}

export function classifyPlaysBlockReason(
  collisions: number,
  unmatchedExisting: number,
): PlaysBlockReasonCode | null {
  if (collisions > 0 && unmatchedExisting > 0) return 'COLLISION_AND_UNMATCHED';
  if (collisions > 0) return 'COLLISION';
  if (unmatchedExisting > 0) return 'UNMATCHED_EXISTING';
  return null;
}

/**
 * Derives the next durable plays-block state for a poll-state row from the current tick's
 * reconciliation outcome.
 *
 * - Unblocked: every field clears. This is the entire mechanism behind "a later safe snapshot
 *   clears the block automatically" — no repair action is involved.
 * - Blocked, first occurrence: `playsBlockedAt` is stamped with `now`.
 * - Blocked, repeat occurrence: the original `playsBlockedAt` is preserved (so operators can see
 *   how long a game has been stuck) while `playsBlockReason` is refreshed to the current code.
 *   This is a pure read/refresh — no repair is ever attempted automatically here.
 */
export function derivePlaysBlockState(
  previous: PlaysBlockState,
  blocked: boolean,
  reasonCode: PlaysBlockReasonCode | null,
  now: Date,
): PlaysBlockState {
  if (!blocked) {
    return { playsBlockedAt: null, playsBlockReason: null, playsReviewRequired: false };
  }
  return {
    playsBlockedAt: previous.playsBlockedAt ?? now,
    playsBlockReason: reasonCode,
    playsReviewRequired: true,
  };
}
