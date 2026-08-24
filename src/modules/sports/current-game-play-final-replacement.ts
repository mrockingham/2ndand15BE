import { createHash } from 'node:crypto';

import type {
  CurrentGamePlayProvider,
  NormalizedCurrentGamePlaySnapshot,
} from './current-game-play-provider.js';
import type { CurrentGamePlayRepository } from './current-game-play.repository.js';
import { identifyPlays, type IdentifiedPlay } from './sync-current-game-plays.js';
import { CurrentGameSyncError } from './sync-current-games.js';

export type FinalReplacementPhase = 'FINAL_IMMEDIATE' | 'FINAL_10' | 'FINAL_60';

export interface FinalReplacementInput {
  readonly gameId: string;
  readonly phase: FinalReplacementPhase;
  readonly actorEmailSnapshot: string;
  /** Poller path: reuses this already-fetched/normalized snapshot so no extra provider request is
   * made (preserves the documented one-request-per-tick budget). CLI/manual path: omit to fetch
   * fresh via the provider. */
  readonly playsSnapshot?: NormalizedCurrentGamePlaySnapshot;
}

export type FinalReplacementResult =
  | {
      readonly status: 'REPLACED';
      readonly phase: FinalReplacementPhase;
      readonly priorActiveCount: number;
      readonly newActiveCount: number;
      readonly supersededCount: number;
      readonly fingerprint: string;
      readonly auditEventId: string;
    }
  | {
      readonly status: 'NOOP_UNCHANGED';
      readonly phase: FinalReplacementPhase;
      readonly activeCount: number;
      readonly fingerprint: string;
    }
  | {
      readonly status: 'VALIDATION_FAILED';
      readonly phase: FinalReplacementPhase;
      readonly reasonCode: 'FINAL_SNAPSHOT_INVALID';
      readonly reason: string;
    };

/** The fields a fingerprint is built from — deliberately excludes DB ids, provider ids, and any
 * timestamp that changes per-request without the play content changing. Shared by `GamePlay` and
 * `IdentifiedPlay`, so the same function fingerprints both currently-active stored rows and a
 * freshly-identified provider snapshot with no new storage. */
interface FingerprintablePlay {
  readonly sequence: number;
  readonly period: number;
  readonly clock: string;
  readonly playType: string;
  readonly description: string;
  readonly possessionTeamId: string | null;
  readonly startDown: number | null;
  readonly startDistance: number | null;
  readonly startYardLine: number | null;
  readonly endDown: number | null;
  readonly endDistance: number | null;
  readonly endYardLine: number | null;
  readonly isScoringPlay: boolean;
  readonly isPenalty: boolean;
  readonly isTurnover: boolean;
}

export function computeFinalSnapshotFingerprint(plays: readonly FingerprintablePlay[]): string {
  const sorted = [...plays].sort((left, right) => left.sequence - right.sequence);
  const canonical = sorted.map((play) => [
    play.sequence,
    play.period,
    play.clock,
    play.playType,
    play.description,
    play.possessionTeamId,
    play.startDown,
    play.startDistance,
    play.startYardLine,
    play.endDown,
    play.endDistance,
    play.endYardLine,
    play.isScoringPlay,
    play.isPenalty,
    play.isTurnover,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface FinalSnapshotValidation {
  readonly valid: boolean;
  readonly reason: string | null;
  readonly noopEmpty: boolean;
}

/**
 * Structural validation for an authoritative FINAL replacement — pure, no I/O. Sequence
 * contiguity and playKey uniqueness are checked defensively even though `identifyPlays`
 * guarantees both by construction, rather than trusting that invariant silently. The plausibility
 * guard is deliberately the plain `finalCount >= existingActiveCount` rule — no invented
 * percentage threshold.
 */
export function validateFinalSnapshot(
  identified: readonly IdentifiedPlay[],
  existingActiveCount: number,
): FinalSnapshotValidation {
  if (identified.length === 0) {
    if (existingActiveCount === 0) return { valid: true, reason: null, noopEmpty: true };
    return {
      valid: false,
      reason: 'The FINAL provider snapshot is empty while live plays are currently active.',
      noopEmpty: false,
    };
  }
  const sequences = identified.map((play) => play.sequence).sort((left, right) => left - right);
  const contiguous = sequences.every((sequence, index) => sequence === index + 1);
  if (!contiguous) {
    return {
      valid: false,
      reason: 'The normalized FINAL snapshot sequence values are not contiguous starting at 1.',
      noopEmpty: false,
    };
  }
  const uniquePlayKeys = new Set(identified.map((play) => play.playKey));
  if (uniquePlayKeys.size !== identified.length) {
    return {
      valid: false,
      reason: 'The normalized FINAL snapshot contains duplicate play keys.',
      noopEmpty: false,
    };
  }
  if (existingActiveCount > 0 && identified.length < existingActiveCount) {
    return {
      valid: false,
      reason: `The FINAL snapshot (${String(identified.length)} plays) is smaller than the currently active live snapshot (${String(existingActiveCount)} plays); refusing to replace.`,
      noopEmpty: false,
    };
  }
  return { valid: true, reason: null, noopEmpty: false };
}

export class FinalPlaySnapshotService {
  constructor(
    private readonly playProvider: CurrentGamePlayProvider,
    private readonly playRepository: CurrentGamePlayRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async replace(input: FinalReplacementInput): Promise<FinalReplacementResult> {
    const target = await this.playRepository.findTarget(
      input.gameId,
      this.playProvider.providerKey,
    );
    if (target === null) {
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    }
    if (target.status !== 'FINAL') {
      throw new CurrentGameSyncError(
        'GAME_NOT_FINAL',
        'Authoritative FINAL replacement requires the internal game to be FINAL.',
      );
    }
    const providerGameId = target.providerMapping?.providerGameId;
    if (providerGameId === undefined) {
      throw new CurrentGameSyncError(
        'GAME_PROVIDER_MAPPING_REQUIRED',
        'Authoritative FINAL replacement requires a verified provider mapping.',
      );
    }

    const snapshot = await this.resolveSnapshot(input, providerGameId);
    if (
      snapshot.providerGameId !== providerGameId ||
      !sameAbbreviation(snapshot.homeAbbreviation, target.homeAbbreviation) ||
      !sameAbbreviation(snapshot.awayAbbreviation, target.awayAbbreviation)
    ) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_PLAYS_IDENTITY_MISMATCH',
        'Provider plays conflict with the verified game identity or orientation.',
      );
    }

    const identified = identifyPlays(
      input.gameId,
      this.playProvider.providerKey,
      snapshot.plays,
      snapshot,
      target,
    ).plays;

    const validation = validateFinalSnapshot(identified, target.plays.length);
    if (!validation.valid) {
      return {
        status: 'VALIDATION_FAILED',
        phase: input.phase,
        reasonCode: 'FINAL_SNAPSHOT_INVALID',
        reason: validation.reason ?? 'The FINAL snapshot failed validation.',
      };
    }
    if (validation.noopEmpty) {
      return {
        status: 'NOOP_UNCHANGED',
        phase: input.phase,
        activeCount: 0,
        fingerprint: computeFinalSnapshotFingerprint([]),
      };
    }

    const activeFingerprint = computeFinalSnapshotFingerprint(target.plays);
    const finalFingerprint = computeFinalSnapshotFingerprint(identified);
    if (activeFingerprint === finalFingerprint) {
      return {
        status: 'NOOP_UNCHANGED',
        phase: input.phase,
        activeCount: target.plays.length,
        fingerprint: finalFingerprint,
      };
    }

    const sourceUpdatedAt =
      snapshot.providerUpdatedAt === null ? this.now() : new Date(snapshot.providerUpdatedAt);
    const rows = identified.map((play) => {
      const { fullSignature: _full, structuralSignature: _structural, ...row } = play;
      void _full;
      void _structural;
      return { ...row, id: null, sourceUpdatedAt };
    });

    const { auditEventId } = await this.playRepository.replaceWithAuthoritativeFinalSnapshot({
      target,
      rows,
      provider: this.playProvider.providerKey,
      phase: input.phase,
      fingerprint: finalFingerprint,
      actorEmailSnapshot: input.actorEmailSnapshot,
    });

    return {
      status: 'REPLACED',
      phase: input.phase,
      priorActiveCount: target.plays.length,
      newActiveCount: rows.length,
      supersededCount: target.plays.length,
      fingerprint: finalFingerprint,
      auditEventId,
    };
  }

  private async resolveSnapshot(
    input: FinalReplacementInput,
    providerGameId: string,
  ): Promise<NormalizedCurrentGamePlaySnapshot> {
    if (input.playsSnapshot !== undefined) return input.playsSnapshot;
    const batch = await this.playProvider.getGamePlays(providerGameId);
    if (batch.provider !== this.playProvider.providerKey || batch.record === null) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_PLAYS_INVALID',
        batch.failures[0]?.reason ?? 'Provider plays were unavailable.',
      );
    }
    return batch.record;
  }
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonical(left) === canonical(right);
}
