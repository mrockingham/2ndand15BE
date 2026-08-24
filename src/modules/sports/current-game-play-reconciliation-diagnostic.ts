import type { GamePlay } from '../../generated/prisma/client.js';
import type { CurrentGamePlayProvider } from './current-game-play-provider.js';
import type { CurrentGamePlayRepository } from './current-game-play.repository.js';
import { identifyPlays, reconcilePlays, type IdentifiedPlay } from './sync-current-game-plays.js';
import { CurrentGameSyncError } from './sync-current-games.js';

export type SafeRepairCandidate =
  'APPEND_ONLY' | 'STRUCTURAL_RELINK' | 'REBUILD_AFTER_CUTOFF' | 'NO_SAFE_REPAIR';

/** Above this many candidates in a single collision group, disambiguation is not realistically
 * something an operator can confidently do by hand — classify as NO_SAFE_REPAIR instead. */
const STRUCTURAL_RELINK_MAX_CANDIDATES = 6;
const MAX_DIVERGENCE_WINDOWS = 20;

export interface DivergenceWindow {
  readonly period: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly unmatchedStoredCount: number;
}

export interface CollisionCandidateSummary {
  readonly existingPlayId: string;
  readonly sequence: number;
  readonly description: string;
}

export interface CollisionGroupSummary {
  readonly desiredSequence: number;
  readonly desiredDescription: string;
  readonly candidates: readonly CollisionCandidateSummary[];
}

export interface ReconciliationDiagnostic {
  readonly gameId: string;
  readonly generatedAt: string;
  readonly storedCount: number;
  readonly providerCount: number;
  readonly exactMatches: number;
  readonly structuralMatches: number;
  readonly unmatchedStoredCount: number;
  readonly unmatchedProviderCount: number;
  readonly collisions: number;
  readonly reordered: number;
  readonly firstDivergenceSequence: number | null;
  readonly divergenceWindows: readonly DivergenceWindow[];
  readonly divergenceWindowsTruncated: boolean;
  /** Admin-only surface: bounded, and the one place a truncated provider description legitimately
   * appears, since structural-relink disambiguation is impossible without it. Never exposed on
   * the public GamePlay API. */
  readonly collisionGroups: readonly CollisionGroupSummary[];
  readonly safeRepairCandidate: SafeRepairCandidate;
  readonly safeRepairReason: string;
  readonly recommendedCutoffSequence: number | null;
}

export function buildReconciliationDiagnostic(input: {
  readonly gameId: string;
  readonly generatedAt: Date;
  readonly desired: readonly IdentifiedPlay[];
  readonly existing: readonly GamePlay[];
  readonly sourceUpdatedAt: Date;
}): ReconciliationDiagnostic {
  const plan = reconcilePlays(input.desired, input.existing, input.sourceUpdatedAt, {
    includeDiagnosticDetail: true,
  });
  const blocked = plan.collisions > 0 || plan.unmatchedExisting > 0;
  const unmatchedExistingRows = plan.unmatchedExistingRows ?? [];
  const collisionDetails = plan.collisionDetails ?? [];

  const existingById = new Map(input.existing.map((play) => [play.id, play]));
  let exactMatches = 0;
  let structuralMatches = 0;
  for (const row of plan.rows) {
    if (row.id === null) continue;
    const existingRow = existingById.get(row.id);
    if (existingRow === undefined) continue;
    if (existingRow.playKey === row.playKey) exactMatches += 1;
    else structuralMatches += 1;
  }

  const unmatchedProviderCount = plan.inserted;
  const firstDivergenceSequence = computeFirstDivergenceSequence(unmatchedExistingRows);
  const { windows, truncated } = buildDivergenceWindows(unmatchedExistingRows);
  const collisionGroups: readonly CollisionGroupSummary[] = collisionDetails.map((group) => ({
    desiredSequence: group.desiredSequence,
    desiredDescription: group.desiredDescription,
    candidates: group.candidates,
  }));

  const classification = classify({
    blocked,
    collisions: plan.collisions,
    reordered: plan.reordered,
    storedCount: input.existing.length,
    unmatchedExistingRows,
    collisionGroups,
  });

  return {
    gameId: input.gameId,
    generatedAt: input.generatedAt.toISOString(),
    storedCount: input.existing.length,
    providerCount: input.desired.length,
    exactMatches,
    structuralMatches,
    unmatchedStoredCount: unmatchedExistingRows.length,
    unmatchedProviderCount,
    collisions: plan.collisions,
    reordered: plan.reordered,
    firstDivergenceSequence,
    divergenceWindows: windows,
    divergenceWindowsTruncated: truncated,
    collisionGroups,
    safeRepairCandidate: classification.safeRepairCandidate,
    safeRepairReason: classification.safeRepairReason,
    recommendedCutoffSequence: classification.recommendedCutoffSequence,
  };
}

function computeFirstDivergenceSequence(unmatchedExistingRows: readonly GamePlay[]): number | null {
  if (unmatchedExistingRows.length === 0) return null;
  return Math.min(...unmatchedExistingRows.map((row) => row.sequence));
}

function buildDivergenceWindows(unmatchedExistingRows: readonly GamePlay[]): {
  readonly windows: readonly DivergenceWindow[];
  readonly truncated: boolean;
} {
  if (unmatchedExistingRows.length === 0) return { windows: [], truncated: false };
  const sorted = [...unmatchedExistingRows].sort((left, right) => left.sequence - right.sequence);
  const windows: DivergenceWindow[] = [];
  let current: { period: number; fromSequence: number; toSequence: number; count: number } | null =
    null;
  for (const row of sorted) {
    if (
      current !== null &&
      current.period === row.period &&
      row.sequence === current.toSequence + 1
    ) {
      current.toSequence = row.sequence;
      current.count += 1;
      continue;
    }
    if (current !== null) {
      windows.push({
        period: current.period,
        fromSequence: current.fromSequence,
        toSequence: current.toSequence,
        unmatchedStoredCount: current.count,
      });
    }
    current = {
      period: row.period,
      fromSequence: row.sequence,
      toSequence: row.sequence,
      count: 1,
    };
  }
  if (current !== null) {
    windows.push({
      period: current.period,
      fromSequence: current.fromSequence,
      toSequence: current.toSequence,
      unmatchedStoredCount: current.count,
    });
  }
  const sortedBySize = [...windows].sort(
    (left, right) => right.unmatchedStoredCount - left.unmatchedStoredCount,
  );
  const bounded = sortedBySize.slice(0, MAX_DIVERGENCE_WINDOWS);
  const boundedIds = new Set(
    bounded.map((window) => `${String(window.period)}:${String(window.fromSequence)}`),
  );
  const ordered = windows.filter((window) =>
    boundedIds.has(`${String(window.period)}:${String(window.fromSequence)}`),
  );
  return { windows: ordered, truncated: windows.length > MAX_DIVERGENCE_WINDOWS };
}

function classify(input: {
  readonly blocked: boolean;
  readonly collisions: number;
  readonly reordered: number;
  readonly storedCount: number;
  readonly unmatchedExistingRows: readonly GamePlay[];
  readonly collisionGroups: readonly CollisionGroupSummary[];
}): {
  readonly safeRepairCandidate: SafeRepairCandidate;
  readonly safeRepairReason: string;
  readonly recommendedCutoffSequence: number | null;
} {
  if (!input.blocked) {
    return {
      safeRepairCandidate: 'APPEND_ONLY',
      safeRepairReason: 'Every stored play still matches the provider snapshot; nothing to repair.',
      recommendedCutoffSequence: null,
    };
  }

  // A collision candidate is itself always "unmatched" (reconcilePlays never picks a winner among
  // ambiguous candidates), so unmatched rows that are entirely accounted for by collision groups
  // are expected here and don't disqualify STRUCTURAL_RELINK — only unmatched rows *outside* any
  // collision group indicate a divergence collisions alone can't explain.
  const collisionCandidateIds = new Set(
    input.collisionGroups.flatMap((group) =>
      group.candidates.map((candidate) => candidate.existingPlayId),
    ),
  );
  const nonCollisionUnmatched = input.unmatchedExistingRows.filter(
    (row) => !collisionCandidateIds.has(row.id),
  );

  if (
    nonCollisionUnmatched.length === 0 &&
    input.collisionGroups.length > 0 &&
    input.collisionGroups.every(
      (group) => group.candidates.length <= STRUCTURAL_RELINK_MAX_CANDIDATES,
    )
  ) {
    return {
      safeRepairCandidate: 'STRUCTURAL_RELINK',
      safeRepairReason:
        'Every stored play still matches structurally; only a bounded set of ambiguous ' +
        'structural-match collisions need operator disambiguation via manual links.',
      recommendedCutoffSequence: null,
    };
  }

  if (input.collisions === 0 && input.reordered === 0) {
    const cutoff = trailingCutoffSequence(input.storedCount, input.unmatchedExistingRows);
    if (cutoff !== null) {
      return {
        safeRepairCandidate: 'REBUILD_AFTER_CUTOFF',
        safeRepairReason:
          `Every stored play up to sequence ${String(cutoff)} matches the provider snapshot; ` +
          'only a contiguous trailing block of later stored plays is unmatched.',
        recommendedCutoffSequence: cutoff,
      };
    }
  }

  return {
    safeRepairCandidate: 'NO_SAFE_REPAIR',
    safeRepairReason:
      'Divergence is not confined to a bounded set of structural collisions or a contiguous ' +
      'trailing block, so no repair mode can be applied without risking data loss.',
    recommendedCutoffSequence: null,
  };
}

/** Returns the last sequence number that is safely retained (the recommended cutoff) if and only
 * if the unmatched rows are exactly the trailing block of stored sequences — i.e. every stored
 * row at or before the cutoff matched, and every stored row after it did not. Returns null when
 * the unmatched rows are scattered rather than a clean trailing run. */
function trailingCutoffSequence(
  storedCount: number,
  unmatchedExistingRows: readonly GamePlay[],
): number | null {
  if (unmatchedExistingRows.length === 0 || unmatchedExistingRows.length >= storedCount)
    return null;
  const unmatchedSequences = new Set(unmatchedExistingRows.map((row) => row.sequence));
  const cutoff = Math.min(...unmatchedExistingRows.map((row) => row.sequence)) - 1;
  for (
    let sequence = cutoff + 1;
    sequence <= cutoff + unmatchedExistingRows.length;
    sequence += 1
  ) {
    if (!unmatchedSequences.has(sequence)) return null;
  }
  return cutoff;
}

export class ReconciliationDiagnosticService {
  constructor(
    private readonly playProvider: CurrentGamePlayProvider,
    private readonly playRepository: CurrentGamePlayRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async diagnose(gameId: string): Promise<ReconciliationDiagnostic> {
    const target = await this.playRepository.findTarget(gameId, this.playProvider.providerKey);
    if (target === null) {
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    }
    const providerGameId = target.providerMapping?.providerGameId;
    if (providerGameId === undefined) {
      throw new CurrentGameSyncError(
        'GAME_PROVIDER_MAPPING_REQUIRED',
        'Structured play diagnostics require a verified provider mapping.',
      );
    }
    const batch = await this.playProvider.getGamePlays(providerGameId);
    if (batch.provider !== this.playProvider.providerKey || batch.record === null) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_PLAYS_INVALID',
        batch.failures[0]?.reason ?? 'Provider plays were unavailable.',
      );
    }
    const snapshot = batch.record;
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
    const now = this.now();
    const sourceUpdatedAt =
      snapshot.providerUpdatedAt === null ? now : new Date(snapshot.providerUpdatedAt);
    const identified = identifyPlays(
      gameId,
      this.playProvider.providerKey,
      snapshot.plays,
      snapshot,
      target,
    );
    return buildReconciliationDiagnostic({
      gameId,
      generatedAt: now,
      desired: identified.plays,
      existing: target.plays,
      sourceUpdatedAt,
    });
  }
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonical(left) === canonical(right);
}
