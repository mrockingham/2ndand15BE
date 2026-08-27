import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { GamePlay } from '../../generated/prisma/client.js';
import type { CurrentGamePlayProvider } from './current-game-play-provider.js';
import type {
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import type { CurrentGamePollStateRepository } from './current-game-poll-state.repository.js';
import {
  identifyPlays,
  reconcilePlays,
  type IdentifiedPlay,
  type ManualPlayLink,
  type ReconciliationPlan,
} from './sync-current-game-plays.js';
import { CurrentGameSyncError } from './sync-current-games.js';

export type RepairMode = 'APPEND_ONLY' | 'STRUCTURAL_RELINK' | 'REBUILD_AFTER_CUTOFF';

export interface RepairInput {
  readonly gameId: string;
  readonly mode: RepairMode;
  readonly manualLinks?: readonly ManualPlayLink[];
  readonly cutoffSequence?: number;
  readonly actor: AuditActor;
  readonly reason: string;
}

export interface RepairResult {
  readonly mode: RepairMode;
  readonly applied: boolean;
  readonly priorStoredCount: number;
  readonly newStoredCount: number;
  readonly supersededCount: number;
  readonly inserted: number;
  readonly updated: number;
  readonly auditEventId: string;
}

export class PlayReconciliationRepairService {
  constructor(
    private readonly playProvider: CurrentGamePlayProvider,
    private readonly playRepository: CurrentGamePlayRepository,
    private readonly pollStateRepository: CurrentGamePollStateRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async repair(input: RepairInput): Promise<RepairResult> {
    const { target, identified, sourceUpdatedAt } = await this.fetchFreshSnapshot(input.gameId);

    if (input.mode === 'REBUILD_AFTER_CUTOFF') {
      return this.repairRebuildAfterCutoff(input, target, identified, sourceUpdatedAt);
    }

    const plan = reconcilePlays(identified, target.plays, sourceUpdatedAt, {
      ...(input.mode === 'STRUCTURAL_RELINK' ? { manualLinks: input.manualLinks ?? [] } : {}),
      includeDiagnosticDetail: true,
    });
    const blocked = plan.collisions > 0 || plan.unmatchedExisting > 0;
    if (blocked) {
      throw new CurrentGameSyncError(
        input.mode === 'STRUCTURAL_RELINK' ? 'REPAIR_LINKS_INCOMPLETE' : 'REPAIR_STILL_BLOCKED',
        input.mode === 'STRUCTURAL_RELINK'
          ? 'The supplied manual links do not resolve every collision; no repair was applied.'
          : 'The current provider snapshot still blocks reconciliation; no repair was applied.',
      );
    }
    if (plan.inserted === 0 && plan.updated === 0) {
      throw new CurrentGameSyncError(
        'REPAIR_NOT_NEEDED',
        'The current provider snapshot already matches the stored plays; no repair was applied.',
      );
    }
    const { auditEventId } = await this.playRepository.applySnapshot({
      target,
      rows: plan.rows,
      provider: this.playProvider.providerKey,
      usageMode: 'approved',
      inserted: plan.inserted,
      updated: plan.updated,
      actor: input.actor,
      auditAction:
        input.mode === 'STRUCTURAL_RELINK'
          ? 'CURRENT_GAME_PLAYS_REPAIR_RELINKED'
          : 'CURRENT_GAME_PLAYS_REPAIR_APPENDED',
      auditReason: input.reason,
    });
    await this.pollStateRepository.clearPlaysBlock(input.gameId, this.now());
    return {
      mode: input.mode,
      applied: true,
      priorStoredCount: target.plays.length,
      newStoredCount: target.plays.length + plan.inserted,
      supersededCount: 0,
      inserted: plan.inserted,
      updated: plan.updated,
      auditEventId,
    };
  }

  private async repairRebuildAfterCutoff(
    input: RepairInput,
    target: CurrentGamePlayTarget,
    identified: readonly IdentifiedPlay[],
    sourceUpdatedAt: Date,
  ): Promise<RepairResult> {
    if (input.cutoffSequence === undefined) {
      throw new CurrentGameSyncError(
        'REPAIR_CUTOFF_REQUIRED',
        'rebuild-after-cutoff requires an explicit cutoffSequence.',
      );
    }
    const cutoffSequence = input.cutoffSequence;
    const validation = validateRebuildCutoff(
      identified,
      target.plays,
      sourceUpdatedAt,
      cutoffSequence,
    );
    if (!validation.valid) {
      throw new CurrentGameSyncError('REPAIR_CUTOFF_INVALID', validation.reason);
    }
    const { plan } = validation;
    const headRows = plan.rows.filter((row) => row.sequence <= cutoffSequence);
    const tailRows = plan.rows
      .filter((row) => row.sequence > cutoffSequence)
      .map((row) => ({ ...row, id: null, sourceUpdatedAt }));
    const supersedeIds = target.plays
      .filter((row) => row.sequence > cutoffSequence)
      .map((row) => row.id);
    const rows = [...headRows, ...tailRows];
    const inserted = rows.filter((row) => row.id === null).length;
    const updated = rows.filter((row) => row.id !== null).length;
    const { auditEventId } = await this.playRepository.applyRepair({
      target,
      rows,
      supersedeIds,
      provider: this.playProvider.providerKey,
      actor: input.actor,
      auditAction: 'CURRENT_GAME_PLAYS_REPAIR_REBUILT',
      auditReason: input.reason,
      cutoffSequence,
    });
    await this.pollStateRepository.clearPlaysBlock(input.gameId, this.now());
    return {
      mode: 'REBUILD_AFTER_CUTOFF',
      applied: true,
      priorStoredCount: target.plays.length,
      newStoredCount: target.plays.length - supersedeIds.length + tailRows.length,
      supersededCount: supersedeIds.length,
      inserted,
      updated,
      auditEventId,
    };
  }

  private async fetchFreshSnapshot(gameId: string): Promise<{
    readonly target: CurrentGamePlayTarget;
    readonly identified: readonly IdentifiedPlay[];
    readonly sourceUpdatedAt: Date;
  }> {
    const target = await this.playRepository.findTarget(gameId, this.playProvider.providerKey);
    if (target === null) {
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    }
    const providerGameId = target.providerMapping?.providerGameId;
    if (providerGameId === undefined) {
      throw new CurrentGameSyncError(
        'GAME_PROVIDER_MAPPING_REQUIRED',
        'Structured play repair requires a verified provider mapping.',
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
    return { target, identified: identified.plays, sourceUpdatedAt };
  }
}

/**
 * Re-validates the REBUILD_AFTER_CUTOFF invariant against a freshly-fetched plan: every active
 * stored play at or before `cutoffSequence` must be deterministically matched at that exact same
 * sequence, with zero collisions anywhere and zero reordering at or before the cutoff. This is a
 * hard fail-closed gate with no force/override — any violation rejects the whole repair.
 */
function validateRebuildCutoff(
  identified: readonly IdentifiedPlay[],
  existing: readonly GamePlay[],
  sourceUpdatedAt: Date,
  cutoffSequence: number,
):
  | { readonly valid: true; readonly plan: ReconciliationPlan }
  | { readonly valid: false; readonly reason: string } {
  const plan = reconcilePlays(identified, existing, sourceUpdatedAt, {
    includeDiagnosticDetail: true,
  });
  if (plan.collisions > 0) {
    return {
      valid: false,
      reason:
        'Unresolved structural-match collisions remain; a cutoff rebuild requires zero collisions.',
    };
  }
  const unmatchedExistingRows = plan.unmatchedExistingRows ?? [];
  if (unmatchedExistingRows.some((row) => row.sequence <= cutoffSequence)) {
    return {
      valid: false,
      reason:
        'A stored play at or before the cutoff sequence is unmatched against the current provider snapshot.',
    };
  }
  const existingById = new Map(existing.map((row) => [row.id, row]));
  for (const row of plan.rows) {
    if (row.id === null || row.sequence > cutoffSequence) continue;
    const existingRow = existingById.get(row.id);
    if (existingRow?.sequence !== row.sequence) {
      return {
        valid: false,
        reason:
          'A stored play at or before the cutoff sequence has reordered against the current provider snapshot.',
      };
    }
  }
  const headExisting = existing.filter((row) => row.sequence <= cutoffSequence);
  const matchedHeadIds = new Set(
    plan.rows
      .filter((row) => row.id !== null && row.sequence <= cutoffSequence)
      .map((row) => row.id),
  );
  if (headExisting.some((row) => !matchedHeadIds.has(row.id))) {
    return {
      valid: false,
      reason:
        'Not every stored play at or before the cutoff sequence matched the current provider snapshot.',
    };
  }
  return { valid: true, plan };
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonical(left) === canonical(right);
}
