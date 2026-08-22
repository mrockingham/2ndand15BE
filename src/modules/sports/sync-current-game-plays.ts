import { createHash } from 'node:crypto';

import type { GamePlay } from '../../generated/prisma/client.js';
import type {
  CurrentGamePlayProvider,
  NormalizedCurrentGamePlay,
} from './current-game-play-provider.js';
import type {
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
  CurrentGamePlayWrite,
} from './current-game-play.repository.js';
import {
  assertCurrentGameMutationAllowed,
  type CurrentGameExecutionPolicy,
  CurrentGameSyncError,
} from './sync-current-games.js';

export interface SyncCurrentGamePlaysOptions {
  readonly gameId: string;
  readonly apply: boolean;
  readonly policy: CurrentGameExecutionPolicy;
}

export interface CurrentGamePlayCoverage {
  readonly providerPlays: number;
  readonly normalizedPlays: number;
  readonly unresolvedPossession: number;
  readonly missingStartDownDistance: number;
  readonly missingEndDownDistance: number;
  readonly fieldPositionFailures: number;
  readonly unknownPlayTypes: number;
  readonly duplicateSignatures: number;
  readonly collisionResolutions: number;
  readonly percentages: {
    readonly possession: number;
    readonly startDownDistance: number;
    readonly endDownDistance: number;
    readonly startFieldPosition: number;
    readonly endFieldPosition: number;
  };
}

export interface CurrentGamePlaySyncReport {
  readonly gameId: string;
  readonly provider: string;
  readonly providerGameId: string;
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly blocked: boolean;
  readonly providerOrder: 'OLDEST_TO_NEWEST';
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly snapshotShorter: boolean;
  readonly reordered: number;
  readonly collisions: number;
  readonly unresolved: number;
  readonly coverage: CurrentGamePlayCoverage;
  readonly timingsMs: {
    readonly providerFetch: number;
    readonly normalization: number;
    readonly reconciliation: number;
    readonly databaseRead: number;
    readonly databaseWrite: number;
    readonly total: number;
  };
}

interface IdentifiedPlay extends Omit<CurrentGamePlayWrite, 'id' | 'sourceUpdatedAt'> {
  readonly fullSignature: string;
  readonly structuralSignature: string;
}

interface ReconciliationPlan {
  readonly rows: readonly CurrentGamePlayWrite[];
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly reordered: number;
  readonly collisions: number;
  readonly unresolved: number;
  readonly unmatchedExisting: number;
}

export class CurrentGamePlaySyncService {
  constructor(
    private readonly provider: CurrentGamePlayProvider,
    private readonly repository: CurrentGamePlayRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sync(options: SyncCurrentGamePlaysOptions): Promise<CurrentGamePlaySyncReport> {
    const totalStarted = performance.now();
    assertCurrentGameMutationAllowed(this.provider.providerKey, options.apply, options.policy);
    const usageMode = options.policy.publicationApproved ? 'approved' : 'evaluation';
    const databaseReadStarted = performance.now();
    const target = await this.repository.findTarget(options.gameId, this.provider.providerKey);
    const databaseRead = performance.now() - databaseReadStarted;
    if (target === null)
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    if (target.status !== 'FINAL') {
      throw new CurrentGameSyncError(
        'GAME_NOT_FINAL',
        'Structured play ingestion is limited to completed games.',
      );
    }
    const providerGameId = target.providerMapping?.providerGameId;
    if (providerGameId === undefined) {
      throw new CurrentGameSyncError(
        'GAME_PROVIDER_MAPPING_REQUIRED',
        'Structured play ingestion requires a verified provider mapping.',
      );
    }
    const batch = await this.provider.getGamePlays(providerGameId);
    if (batch.provider !== this.provider.providerKey || batch.record === null) {
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
    const sourceUpdatedAt =
      snapshot.providerUpdatedAt === null ? this.now() : new Date(snapshot.providerUpdatedAt);
    const identified = identifyPlays(
      options.gameId,
      this.provider.providerKey,
      snapshot.plays,
      snapshot,
      target,
    );
    const coverage = coverageFor(snapshot.plays, identified);
    const reconciliationStarted = performance.now();
    const plan = reconcilePlays(identified.plays, target.plays, sourceUpdatedAt);
    const reconciliation = performance.now() - reconciliationStarted;
    const snapshotShorter = snapshot.plays.length < target.plays.length;
    const blocked = plan.collisions > 0 || plan.unmatchedExisting > 0;
    let databaseWrite = 0;
    let applied = false;
    if (options.apply && !blocked && (plan.inserted > 0 || plan.updated > 0)) {
      const writeStarted = performance.now();
      await this.repository.applySnapshot({
        target,
        rows: plan.rows,
        provider: this.provider.providerKey,
        usageMode,
        inserted: plan.inserted,
        updated: plan.updated,
      });
      databaseWrite = performance.now() - writeStarted;
      applied = true;
    }
    return {
      gameId: options.gameId,
      provider: this.provider.providerKey,
      providerGameId,
      dryRun: !options.apply,
      applied,
      blocked,
      providerOrder: 'OLDEST_TO_NEWEST',
      inserted: plan.inserted,
      updated: plan.updated,
      unchanged: plan.unchanged,
      snapshotShorter,
      reordered: plan.reordered,
      collisions: plan.collisions,
      unresolved: plan.unresolved + plan.unmatchedExisting,
      coverage,
      timingsMs: {
        providerFetch: batch.responseDurationMs,
        normalization: batch.normalizationDurationMs,
        reconciliation: rounded(reconciliation),
        databaseRead: rounded(databaseRead),
        databaseWrite: rounded(databaseWrite),
        total: rounded(performance.now() - totalStarted),
      },
    };
  }
}

export function identifyPlays(
  gameId: string,
  provider: string,
  plays: readonly NormalizedCurrentGamePlay[],
  snapshot: {
    readonly homeProviderTeamId: string;
    readonly awayProviderTeamId: string;
  },
  target: CurrentGamePlayTarget,
): { readonly plays: readonly IdentifiedPlay[]; readonly duplicateSignatures: number } {
  const fullOccurrences = new Map<string, number>();
  const structuralOccurrences = new Map<string, number>();
  let duplicateSignatures = 0;
  return {
    plays: plays.map((play, index) => {
      const possessionTeamId = resolvePossession(play, snapshot, target);
      const structural = canonical([
        gameId,
        play.period,
        play.clock,
        play.playType,
        play.startDown,
        play.startDistance,
        play.startYardLine,
        play.endDown,
        play.endDistance,
        play.endYardLine,
        possessionTeamId,
      ]);
      const full = canonical([
        structural,
        play.description,
        play.isScoringPlay,
        play.isPenalty,
        play.isTurnover,
      ]);
      const fullOccurrence = fullOccurrences.get(full) ?? 0;
      const structuralOccurrence = structuralOccurrences.get(structural) ?? 0;
      if (fullOccurrence > 0) duplicateSignatures += 1;
      fullOccurrences.set(full, fullOccurrence + 1);
      structuralOccurrences.set(structural, structuralOccurrence + 1);
      return {
        gameId,
        playKey: digest(canonical([full, fullOccurrence])),
        reconciliationKey: digest(canonical([structural, structuralOccurrence])),
        sequence: index + 1,
        period: play.period,
        clock: play.clock,
        possessionTeamId,
        playType: play.playType,
        description: play.description,
        startDown: play.startDown,
        startDistance: play.startDistance,
        startYardLine: play.startYardLine,
        endDown: play.endDown,
        endDistance: play.endDistance,
        endYardLine: play.endYardLine,
        isScoringPlay: play.isScoringPlay,
        isPenalty: play.isPenalty,
        isTurnover: play.isTurnover,
        sourceProvider: provider,
        sourcePlayType: play.sourcePlayType,
        fullSignature: full,
        structuralSignature: structural,
      };
    }),
    duplicateSignatures,
  };
}

function resolvePossession(
  play: NormalizedCurrentGamePlay,
  snapshot: { readonly homeProviderTeamId: string; readonly awayProviderTeamId: string },
  target: CurrentGamePlayTarget,
): string | null {
  if (play.possessionProviderTeamId === snapshot.homeProviderTeamId) return target.homeTeamId;
  if (play.possessionProviderTeamId === snapshot.awayProviderTeamId) return target.awayTeamId;
  return null;
}

export function reconcilePlays(
  desired: readonly IdentifiedPlay[],
  existing: readonly GamePlay[],
  sourceUpdatedAt: Date,
): ReconciliationPlan {
  const exact = groupBy(existing, (play) => play.playKey);
  const structural = groupBy(existing, (play) => play.reconciliationKey);
  const used = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let reordered = 0;
  let collisions = 0;
  let unresolved = 0;
  const rows: CurrentGamePlayWrite[] = [];
  for (const desiredPlay of desired) {
    let match = uniqueUnused(exact.get(desiredPlay.playKey), used);
    if (match === undefined) {
      const candidates = (structural.get(desiredPlay.reconciliationKey) ?? []).filter(
        (candidate) => !used.has(candidate.id),
      );
      if (candidates.length > 1) {
        collisions += 1;
        unresolved += 1;
        continue;
      }
      match = candidates[0];
    }
    if (match === undefined) {
      inserted += 1;
      rows.push({ ...stripSignatures(desiredPlay), id: null, sourceUpdatedAt });
      continue;
    }
    used.add(match.id);
    const changed = !sameStoredPlay(match, desiredPlay);
    const sequenceChanged = match.sequence !== desiredPlay.sequence;
    if (sequenceChanged) reordered += 1;
    if (changed || sequenceChanged) updated += 1;
    else unchanged += 1;
    rows.push({
      ...stripSignatures(desiredPlay),
      id: match.id,
      sourceUpdatedAt: changed ? sourceUpdatedAt : match.sourceUpdatedAt,
    });
  }
  return {
    rows,
    inserted,
    updated,
    unchanged,
    reordered,
    collisions,
    unresolved,
    unmatchedExisting: existing.filter((play) => !used.has(play.id)).length,
  };
}

function stripSignatures(
  play: IdentifiedPlay,
): Omit<IdentifiedPlay, 'fullSignature' | 'structuralSignature'> {
  const { fullSignature: _full, structuralSignature: _structural, ...row } = play;
  void _full;
  void _structural;
  return row;
}

function sameStoredPlay(existing: GamePlay, desired: IdentifiedPlay): boolean {
  return (
    existing.playKey === desired.playKey &&
    existing.reconciliationKey === desired.reconciliationKey &&
    existing.period === desired.period &&
    existing.clock === desired.clock &&
    existing.possessionTeamId === desired.possessionTeamId &&
    existing.playType === desired.playType &&
    existing.description === desired.description &&
    existing.startDown === desired.startDown &&
    existing.startDistance === desired.startDistance &&
    existing.startYardLine === desired.startYardLine &&
    existing.endDown === desired.endDown &&
    existing.endDistance === desired.endDistance &&
    existing.endYardLine === desired.endYardLine &&
    existing.isScoringPlay === desired.isScoringPlay &&
    existing.isPenalty === desired.isPenalty &&
    existing.isTurnover === desired.isTurnover &&
    existing.sourceProvider === desired.sourceProvider &&
    existing.sourcePlayType === desired.sourcePlayType
  );
}

function coverageFor(
  providerPlays: readonly NormalizedCurrentGamePlay[],
  identified: { readonly plays: readonly IdentifiedPlay[]; readonly duplicateSignatures: number },
): CurrentGamePlayCoverage {
  const total = providerPlays.length;
  const count = (predicate: (play: NormalizedCurrentGamePlay) => boolean): number =>
    providerPlays.filter(predicate).length;
  const unresolvedPossession = identified.plays.filter(
    (play) => play.possessionTeamId === null,
  ).length;
  return {
    providerPlays: total,
    normalizedPlays: identified.plays.length,
    unresolvedPossession,
    missingStartDownDistance: count(
      (play) => play.startDown === null || play.startDistance === null,
    ),
    missingEndDownDistance: count((play) => play.endDown === null || play.endDistance === null),
    fieldPositionFailures: count((play) => play.fieldPositionFailure),
    unknownPlayTypes: count((play) => play.playType === 'OTHER'),
    duplicateSignatures: identified.duplicateSignatures,
    collisionResolutions: identified.duplicateSignatures,
    percentages: {
      possession: percent(total - unresolvedPossession, total),
      startDownDistance: percent(
        count((play) => play.startDown !== null && play.startDistance !== null),
        total,
      ),
      endDownDistance: percent(
        count((play) => play.endDown !== null && play.endDistance !== null),
        total,
      ),
      startFieldPosition: percent(
        count((play) => play.startYardLine !== null),
        total,
      ),
      endFieldPosition: percent(
        count((play) => play.endYardLine !== null),
        total,
      ),
    },
  };
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function uniqueUnused(
  values: readonly GamePlay[] | undefined,
  used: ReadonlySet<string>,
): GamePlay | undefined {
  const candidates = (values ?? []).filter((value) => !used.has(value.id));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function canonical(value: readonly unknown[]): string {
  return JSON.stringify(value);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameAbbreviation(left: string, right: string): boolean {
  const canonicalAbbreviation = (value: string): string => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'WSH' ? 'WAS' : normalized;
  };
  return canonicalAbbreviation(left) === canonicalAbbreviation(right);
}

function percent(value: number, total: number): number {
  return total === 0 ? 100 : Math.round((value / total) * 10_000) / 100;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
