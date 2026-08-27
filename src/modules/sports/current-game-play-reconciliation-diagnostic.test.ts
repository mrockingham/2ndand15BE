import { describe, expect, it } from 'vitest';

import type { GamePlay } from '../../generated/prisma/client.js';
import type {
  CurrentGamePlayBatch,
  CurrentGamePlayProvider,
} from './current-game-play-provider.js';
import type {
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import {
  buildReconciliationDiagnostic,
  ReconciliationDiagnosticService,
} from './current-game-play-reconciliation-diagnostic.js';
import { identifyPlays, type IdentifiedPlay } from './sync-current-game-plays.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const homeTeamId = '00000000-0000-4000-8000-000000000002';
const awayTeamId = '00000000-0000-4000-8000-000000000003';
const target: CurrentGamePlayTarget = {
  id: gameId,
  status: 'FINAL',
  homeTeamId,
  awayTeamId,
  homeAbbreviation: 'NE',
  awayAbbreviation: 'PHI',
  providerMapping: { providerGameId: '565939' },
  plays: [],
};
const snapshot = { homeProviderTeamId: 'home-provider', awayProviderTeamId: 'away-provider' };

function play(
  description: string,
  overrides: {
    readonly period?: number;
    readonly clock?: string;
    readonly startYardLine?: number;
  } = {},
) {
  // startYardLine is varied per call site so plays are structurally distinct by default — the
  // structural (reconciliation) key excludes `description`, so two plays with identical
  // down/distance/yardLine/clock/period would otherwise share a structural signature regardless
  // of what they're called, which would silently defeat tests that need genuinely distinct plays.
  const startYardLine = overrides.startYardLine ?? 25;
  return {
    providerOrder: 0,
    period: overrides.period ?? 1,
    clock: overrides.clock ?? '9:01',
    possessionProviderTeamId: 'away-provider',
    playType: 'PASS' as const,
    sourcePlayType: 'Pass Reception',
    description,
    startDown: 1,
    startDistance: 10,
    startYardLine,
    endDown: 1,
    endDistance: 10,
    endYardLine: startYardLine + 10,
    isScoringPlay: false,
    isPenalty: false,
    isTurnover: false,
    fieldPositionFailure: false,
  };
}

function identify(plays: readonly ReturnType<typeof play>[]): readonly IdentifiedPlay[] {
  return identifyPlays(gameId, 'highlightly', plays, snapshot, target).plays;
}

function stored(row: IdentifiedPlay, id: string): GamePlay {
  return {
    ...row,
    id,
    sourceUpdatedAt: new Date('2026-08-16T03:00:00Z'),
    supersededAt: null,
    supersededByRunId: null,
    createdAt: new Date('2026-08-16T03:00:00Z'),
    updatedAt: new Date('2026-08-16T03:00:00Z'),
  };
}

function requiredPlay(value: IdentifiedPlay | undefined): IdentifiedPlay {
  if (value === undefined) throw new Error('Expected an identified play.');
  return value;
}

function diagnose(desired: readonly IdentifiedPlay[], existing: readonly GamePlay[]) {
  return buildReconciliationDiagnostic({
    gameId,
    generatedAt: new Date('2026-08-23T00:00:00Z'),
    desired,
    existing,
    sourceUpdatedAt: new Date('2026-08-23T00:00:00Z'),
  });
}

describe('buildReconciliationDiagnostic classification', () => {
  it('classifies an unblocked snapshot as APPEND_ONLY', () => {
    const identified = identify([play('one'), play('two')]);
    const existing = [stored(requiredPlay(identified[0]), 'stored-1')];
    const diagnostic = diagnose(identified, existing);
    expect(diagnostic.safeRepairCandidate).toBe('APPEND_ONLY');
    expect(diagnostic.collisions).toBe(0);
    expect(diagnostic.unmatchedStoredCount).toBe(0);
  });

  it('classifies a bounded structural collision as STRUCTURAL_RELINK', () => {
    const desired = requiredPlay(identify([play('corrected')])[0]);
    const candidateBase = requiredPlay(identify([play('original')])[0]);
    const candidateA = stored(candidateBase, 'candidate-a');
    const candidateB = { ...stored(candidateBase, 'candidate-b'), playKey: 'a-distinct-play-key' };
    const diagnostic = diagnose([desired], [candidateA, candidateB]);
    expect(diagnostic.safeRepairCandidate).toBe('STRUCTURAL_RELINK');
    expect(diagnostic.collisionGroups).toHaveLength(1);
    expect(diagnostic.collisionGroups[0]?.candidates).toHaveLength(2);
    expect(diagnostic.collisionGroups[0]?.desiredDescription).toBe('corrected');
  });

  it('classifies a contiguous trailing divergence (shaped like the PHI@NE case) as REBUILD_AFTER_CUTOFF', () => {
    // Simulates the real-world shape: a full head of plays still matches, but a later trailing
    // block was fully re-numbered/re-described by the provider's FINAL snapshot. The head plays
    // are byte-identical between the two snapshots (same array), so they match exactly; the tail
    // plays are given non-overlapping startYardLine values so the two tail sets never coincide
    // structurally, guaranteeing a clean "old tail unmatched / new tail inserted" split.
    const headPlays = Array.from({ length: 8 }, (_, index) =>
      play(`head-${String(index)}`, { startYardLine: 10 + index }),
    );
    const staleTailPlays = Array.from({ length: 4 }, (_, index) =>
      play(`stale-tail-${String(index)}`, { period: 3, startYardLine: 40 + index }),
    );
    const rebuiltTailPlays = Array.from({ length: 4 }, (_, index) =>
      play(`rebuilt-tail-${String(index)}`, { period: 3, startYardLine: 60 + index }),
    );
    const oldSnapshot = identify([...headPlays, ...staleTailPlays]);
    const newSnapshot = identify([...headPlays, ...rebuiltTailPlays]);
    const storedRows = oldSnapshot.map((row, index) => stored(row, `stored-${String(index)}`));
    const diagnostic = diagnose(newSnapshot, storedRows);
    expect(diagnostic.safeRepairCandidate).toBe('REBUILD_AFTER_CUTOFF');
    expect(diagnostic.recommendedCutoffSequence).toBe(8);
    expect(diagnostic.unmatchedStoredCount).toBe(4);
  });

  it('classifies scattered divergence as NO_SAFE_REPAIR', () => {
    // Odd-indexed stored plays are unmatched, interleaved with matched ones — not a clean
    // trailing block, so no repair mode is confidently safe.
    const identified = identify(
      Array.from({ length: 6 }, (_, index) => play(`play-${String(index)}`)),
    );
    const existing = identified.map((row, index) =>
      index % 2 === 0
        ? stored(row, `stored-${String(index)}`)
        : {
            ...stored(row, `stored-${String(index)}`),
            playKey: `stale-${String(index)}`,
            reconciliationKey: `stale-structural-${String(index)}`,
          },
    );
    const diagnostic = diagnose(
      identified.filter((_, index) => index % 2 === 0),
      existing,
    );
    expect(diagnostic.safeRepairCandidate).toBe('NO_SAFE_REPAIR');
  });

  it('never includes a bare description field on the bulk diagnostic surface', () => {
    const desired = requiredPlay(identify([play('corrected')])[0]);
    const candidateBase = requiredPlay(identify([play('original')])[0]);
    const candidateA = stored(candidateBase, 'candidate-a');
    const candidateB = { ...stored(candidateBase, 'candidate-b'), playKey: 'a-distinct-play-key' };
    const diagnostic = diagnose([desired], [candidateA, candidateB]);
    const { collisionGroups, ...bulkFields } = diagnostic;
    void collisionGroups;
    expect(JSON.stringify(bulkFields)).not.toContain('description');
    expect(JSON.stringify(diagnostic.divergenceWindows)).not.toContain('description');
  });

  it('bounds divergence windows and flags truncation beyond the cap', () => {
    // 25 scattered single-play unmatched windows, one per period, forces more than the 20-window
    // cap so truncation must be reported rather than dumping every raw window.
    const identified = identify(
      Array.from({ length: 25 }, (_, index) =>
        play(`play-${String(index)}`, { period: (index % 4) + 1 }),
      ),
    );
    const existing = identified.map((row, index) => ({
      ...stored(row, `stored-${String(index)}`),
      playKey: `stale-${String(index)}`,
      reconciliationKey: `stale-structural-${String(index)}`,
    }));
    const diagnostic = diagnose([], existing);
    expect(diagnostic.divergenceWindowsTruncated).toBe(true);
    expect(diagnostic.divergenceWindows.length).toBeLessThanOrEqual(20);
  });
});

describe('ReconciliationDiagnosticService', () => {
  function harness(overrides: { readonly providerGameId?: string } = {}) {
    const providerGameId = overrides.providerGameId ?? '565939';
    const batch: CurrentGamePlayBatch = {
      provider: 'highlightly',
      record: {
        provider: 'highlightly',
        providerGameId,
        homeProviderTeamId: 'home-provider',
        awayProviderTeamId: 'away-provider',
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        plays: [play('one')],
        providerUpdatedAt: null,
      },
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 10,
      normalizationDurationMs: 1,
    };
    const provider: CurrentGamePlayProvider = {
      providerKey: 'highlightly',
      getGamePlays: () => Promise.resolve(batch),
    };
    const repository: CurrentGamePlayRepository = {
      findTarget: () => Promise.resolve(target),
      applySnapshot: () => Promise.reject(new Error('not exercised')),
      applyRepair: () => Promise.reject(new Error('not exercised')),
      replaceWithAuthoritativeFinalSnapshot: () => Promise.reject(new Error('not exercised')),
    };
    return { provider, repository };
  }

  it('reports GAME_NOT_FOUND when the internal game is missing', async () => {
    const { provider } = harness();
    const repository: CurrentGamePlayRepository = {
      findTarget: () => Promise.resolve(null),
      applySnapshot: () => Promise.reject(new Error('not exercised')),
      applyRepair: () => Promise.reject(new Error('not exercised')),
      replaceWithAuthoritativeFinalSnapshot: () => Promise.reject(new Error('not exercised')),
    };
    const service = new ReconciliationDiagnosticService(provider, repository);
    await expect(service.diagnose(gameId)).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
  });

  it('reports GAME_PROVIDER_MAPPING_REQUIRED when no provider mapping is verified', async () => {
    const { provider } = harness();
    const repository: CurrentGamePlayRepository = {
      findTarget: () => Promise.resolve({ ...target, providerMapping: null }),
      applySnapshot: () => Promise.reject(new Error('not exercised')),
      applyRepair: () => Promise.reject(new Error('not exercised')),
      replaceWithAuthoritativeFinalSnapshot: () => Promise.reject(new Error('not exercised')),
    };
    const service = new ReconciliationDiagnosticService(provider, repository);
    await expect(service.diagnose(gameId)).rejects.toMatchObject({
      code: 'GAME_PROVIDER_MAPPING_REQUIRED',
    });
  });

  it('reports CURRENT_GAME_PLAYS_IDENTITY_MISMATCH on an orientation conflict', async () => {
    const { repository } = harness();
    const batch: CurrentGamePlayBatch = {
      provider: 'highlightly',
      record: {
        provider: 'highlightly',
        providerGameId: '565939',
        homeProviderTeamId: 'home-provider',
        awayProviderTeamId: 'away-provider',
        homeAbbreviation: 'MIA',
        awayAbbreviation: 'BUF',
        plays: [play('one')],
        providerUpdatedAt: null,
      },
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 10,
      normalizationDurationMs: 1,
    };
    const provider: CurrentGamePlayProvider = {
      providerKey: 'highlightly',
      getGamePlays: () => Promise.resolve(batch),
    };
    const service = new ReconciliationDiagnosticService(provider, repository);
    await expect(service.diagnose(gameId)).rejects.toMatchObject({
      code: 'CURRENT_GAME_PLAYS_IDENTITY_MISMATCH',
    });
  });

  it('produces a diagnostic for a healthy game', async () => {
    const { provider, repository } = harness();
    const service = new ReconciliationDiagnosticService(provider, repository);
    const diagnostic = await service.diagnose(gameId);
    expect(diagnostic.gameId).toBe(gameId);
    expect(diagnostic.safeRepairCandidate).toBe('APPEND_ONLY');
  });
});
