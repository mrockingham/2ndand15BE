import { describe, expect, it } from 'vitest';

import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { GamePlay } from '../../generated/prisma/client.js';
import type {
  CurrentGamePlayBatch,
  CurrentGamePlayProvider,
  NormalizedCurrentGamePlay,
} from './current-game-play-provider.js';
import type {
  CurrentGamePlayApplyInput,
  CurrentGamePlayRepairApplyInput,
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import type {
  ClaimedPoll,
  CurrentGamePollStateRepository,
} from './current-game-poll-state.repository.js';
import { PlayReconciliationRepairService } from './current-game-play-repair.js';
import { identifyPlays } from './sync-current-game-plays.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const homeTeamId = '00000000-0000-4000-8000-000000000002';
const awayTeamId = '00000000-0000-4000-8000-000000000003';
const snapshot = { homeProviderTeamId: 'home-provider', awayProviderTeamId: 'away-provider' };
const actor: AuditActor = { userId: null, emailSnapshot: 'operator@example.com', requestId: null };

function play(
  description: string,
  overrides: { readonly period?: number; readonly startYardLine?: number } = {},
): NormalizedCurrentGamePlay {
  // startYardLine is varied per call site so plays are structurally distinct by default — the
  // structural (reconciliation) key excludes `description`, so two plays with identical
  // down/distance/yardLine/clock/period would otherwise share a structural signature.
  const startYardLine = overrides.startYardLine ?? 25;
  return {
    providerOrder: 0,
    period: overrides.period ?? 1,
    clock: '9:01',
    possessionProviderTeamId: 'away-provider',
    playType: 'PASS',
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

function harness(options: {
  readonly initialProviderPlays: readonly NormalizedCurrentGamePlay[];
  readonly initiallyStoredPlays?: readonly GamePlay[];
}) {
  let providerPlays = options.initialProviderPlays;
  let storedPlays: GamePlay[] = [...(options.initiallyStoredPlays ?? [])];
  const allRowsEverWritten: GamePlay[] = [...storedPlays];

  const provider: CurrentGamePlayProvider = {
    providerKey: 'highlightly',
    getGamePlays: () => {
      const batch: CurrentGamePlayBatch = {
        provider: 'highlightly',
        record: {
          provider: 'highlightly',
          providerGameId: '565939',
          homeProviderTeamId: snapshot.homeProviderTeamId,
          awayProviderTeamId: snapshot.awayProviderTeamId,
          homeAbbreviation: 'NE',
          awayAbbreviation: 'PHI',
          plays: providerPlays,
          providerUpdatedAt: null,
        },
        failures: [],
        requestsUsed: 1,
        responseDurationMs: 10,
        normalizationDurationMs: 1,
      };
      return Promise.resolve(batch);
    },
  };

  const applySnapshot = (input: CurrentGamePlayApplyInput) => {
    for (const row of input.rows) {
      if (row.id === null) {
        const created: GamePlay = {
          ...row,
          id: `generated-${String(allRowsEverWritten.length + 1)}`,
        } as GamePlay;
        storedPlays = [...storedPlays, created];
        allRowsEverWritten.push(created);
      } else {
        storedPlays = storedPlays.map((existingRow) =>
          existingRow.id === row.id ? ({ ...row, id: row.id } as GamePlay) : existingRow,
        );
      }
    }
    return Promise.resolve({ auditEventId: 'audit-event-append' });
  };

  const applyRepair = (input: CurrentGamePlayRepairApplyInput) => {
    const supersededAt = new Date('2026-08-23T02:00:00Z');
    for (const id of input.supersedeIds) {
      allRowsEverWritten.forEach((row, index) => {
        if (row.id === id)
          allRowsEverWritten[index] = {
            ...row,
            supersededAt,
            supersededByRunId: 'audit-event-rebuild',
          };
      });
    }
    storedPlays = storedPlays.filter((row) => !input.supersedeIds.includes(row.id));
    for (const row of input.rows) {
      if (row.id === null) {
        const created: GamePlay = {
          ...row,
          id: `generated-${String(allRowsEverWritten.length + 1)}`,
        } as GamePlay;
        storedPlays = [...storedPlays, created];
        allRowsEverWritten.push(created);
      } else {
        storedPlays = storedPlays.map((existingRow) =>
          existingRow.id === row.id ? ({ ...row, id: row.id } as GamePlay) : existingRow,
        );
      }
    }
    return Promise.resolve({ auditEventId: 'audit-event-rebuild' });
  };

  const playRepository: CurrentGamePlayRepository = {
    findTarget: () =>
      Promise.resolve<CurrentGamePlayTarget>({
        id: gameId,
        status: 'FINAL',
        homeTeamId,
        awayTeamId,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        providerMapping: { providerGameId: '565939' },
        plays: storedPlays,
      }),
    applySnapshot,
    applyRepair,
    replaceWithAuthoritativeFinalSnapshot: () => Promise.reject(new Error('not exercised')),
  };

  let clearPlaysBlockCalls = 0;
  const pollStateRepository: CurrentGamePollStateRepository = {
    discoverCandidates: () => Promise.reject(new Error('not exercised')),
    findCandidateGameById: () => Promise.resolve(null),
    ensurePollStates: () => Promise.reject(new Error('not exercised')),
    claimDue: () => Promise.resolve<readonly ClaimedPoll[]>([]),
    claimForRecovery: () => Promise.resolve<ClaimedPoll | null>(null),
    recordSuccess: () => Promise.reject(new Error('not exercised')),
    recordFailure: () => Promise.reject(new Error('not exercised')),
    listPlaysReviewRequired: () => Promise.resolve([]),
    clearPlaysBlock: () => {
      clearPlaysBlockCalls += 1;
      return Promise.resolve();
    },
  };

  const service = new PlayReconciliationRepairService(
    provider,
    playRepository,
    pollStateRepository,
    () => new Date('2026-08-23T02:00:00Z'),
  );

  return {
    service,
    setProviderPlays: (next: readonly NormalizedCurrentGamePlay[]) => {
      providerPlays = next;
    },
    getStoredPlays: () => storedPlays,
    getAllRowsEverWritten: () => allRowsEverWritten,
    getClearPlaysBlockCalls: () => clearPlaysBlockCalls,
  };
}

function storedFrom(
  desired: readonly NormalizedCurrentGamePlay[],
  id: string,
  index = 0,
): GamePlay {
  const identified = identifyPlays(gameId, 'highlightly', desired, snapshot, {
    id: gameId,
    status: 'FINAL',
    homeTeamId,
    awayTeamId,
    homeAbbreviation: 'NE',
    awayAbbreviation: 'PHI',
    providerMapping: { providerGameId: '565939' },
    plays: [],
  }).plays[index];
  if (identified === undefined) throw new Error('Expected an identified play.');
  return {
    ...identified,
    id,
    sourceUpdatedAt: new Date('2026-08-16T03:00:00Z'),
    supersededAt: null,
    supersededByRunId: null,
    createdAt: new Date('2026-08-16T03:00:00Z'),
    updatedAt: new Date('2026-08-16T03:00:00Z'),
  };
}

describe('PlayReconciliationRepairService — APPEND_ONLY', () => {
  it('applies a safe append and clears the durable block', async () => {
    const original = play('kickoff');
    const { service, getStoredPlays, getClearPlaysBlockCalls } = harness({
      initialProviderPlays: [original, play('a new later play')],
      initiallyStoredPlays: [storedFrom([original], 'stored-1')],
    });
    const result = await service.repair({
      gameId,
      mode: 'APPEND_ONLY',
      actor,
      reason: 'safe append',
    });
    expect(result.applied).toBe(true);
    expect(result.inserted).toBe(1);
    expect(result.supersededCount).toBe(0);
    expect(getStoredPlays()).toHaveLength(2);
    expect(getClearPlaysBlockCalls()).toBe(1);
  });

  it('rejects when the current snapshot is still blocked (409 REPAIR_STILL_BLOCKED)', async () => {
    const stored: GamePlay = {
      ...storedFrom([play('original')], 'stored-1'),
      playKey: 'stored-only-play-key',
      reconciliationKey: 'stored-only-reconciliation-key',
    };
    const { service } = harness({
      initialProviderPlays: [play('a different play entirely')],
      initiallyStoredPlays: [stored],
    });
    await expect(
      service.repair({ gameId, mode: 'APPEND_ONLY', actor, reason: 'attempt' }),
    ).rejects.toMatchObject({ code: 'REPAIR_STILL_BLOCKED' });
  });

  it('rejects when nothing has changed (idempotent replay guard)', async () => {
    const original = play('kickoff');
    const { service } = harness({
      initialProviderPlays: [original],
      initiallyStoredPlays: [storedFrom([original], 'stored-1')],
    });
    await expect(
      service.repair({ gameId, mode: 'APPEND_ONLY', actor, reason: 'no-op' }),
    ).rejects.toMatchObject({ code: 'REPAIR_NOT_NEEDED' });
  });

  it('never deletes: a second identical repair attempt does not duplicate the first insert', async () => {
    const original = play('kickoff');
    const { service, getStoredPlays } = harness({
      initialProviderPlays: [original, play('a new later play')],
      initiallyStoredPlays: [storedFrom([original], 'stored-1')],
    });
    await service.repair({ gameId, mode: 'APPEND_ONLY', actor, reason: 'safe append' });
    expect(getStoredPlays()).toHaveLength(2);
    // Replaying with the identical provider snapshot: everything already matches, so the guard
    // rejects rather than silently re-inserting a duplicate.
    await expect(
      service.repair({ gameId, mode: 'APPEND_ONLY', actor, reason: 'safe append again' }),
    ).rejects.toMatchObject({ code: 'REPAIR_NOT_NEEDED' });
    expect(getStoredPlays()).toHaveLength(2);
  });
});

describe('PlayReconciliationRepairService — STRUCTURAL_RELINK', () => {
  it('resolves a collision via manual links and preserves stable ids', async () => {
    // stored-1 and stored-2 share a reconciliation key (a historical data anomaly — exactly the
    // ambiguity this mode exists to resolve by hand). 'corrected' genuinely is stored-1's play;
    // the operator additionally confirms, from outside context the algorithm can't see, that
    // stored-2 is actually the unrelated later play, not a duplicate of stored-1.
    const original = play('original text', { startYardLine: 25 });
    const corrected = play('corrected text', { startYardLine: 25 });
    const unrelated = play('an unrelated later play', { startYardLine: 50 });
    const storedMain = storedFrom([original], 'stored-1');
    const collidingRow: GamePlay = {
      ...storedFrom([original], 'stored-2'),
      playKey: 'a-distinct-key',
    };
    const { service, getStoredPlays } = harness({
      initialProviderPlays: [corrected, unrelated],
      initiallyStoredPlays: [storedMain, collidingRow],
    });
    const result = await service.repair({
      gameId,
      mode: 'STRUCTURAL_RELINK',
      actor,
      reason: 'disambiguated by operator',
      manualLinks: [
        { existingPlayId: 'stored-1', desiredSequence: 1 },
        { existingPlayId: 'stored-2', desiredSequence: 2 },
      ],
    });
    expect(result.applied).toBe(true);
    expect(getStoredPlays().find((row) => row.id === 'stored-1')?.description).toBe(
      'corrected text',
    );
    expect(getStoredPlays().find((row) => row.id === 'stored-2')?.description).toBe(
      'an unrelated later play',
    );
  });

  it('rejects when the supplied links do not resolve every collision (409 REPAIR_LINKS_INCOMPLETE)', async () => {
    const original = play('original text');
    const corrected = play('corrected text');
    const { service } = harness({
      initialProviderPlays: [corrected],
      initiallyStoredPlays: [
        storedFrom([original], 'stored-1'),
        { ...storedFrom([original], 'stored-2'), playKey: 'a-distinct-key' },
      ],
    });
    await expect(
      service.repair({
        gameId,
        mode: 'STRUCTURAL_RELINK',
        actor,
        reason: 'incomplete',
        manualLinks: [],
      }),
    ).rejects.toMatchObject({ code: 'REPAIR_LINKS_INCOMPLETE' });
  });
});

describe('PlayReconciliationRepairService — REBUILD_AFTER_CUTOFF', () => {
  function buildTrailingDivergenceScenario() {
    // Head plays are byte-identical between the "old" (stored) and "new" (provider) snapshots, so
    // they match exactly. Stale vs. rebuilt tail plays use non-overlapping startYardLine values so
    // they never coincide structurally — a clean "old tail unmatched / new tail inserted" split.
    // Both stored rows and the fresh provider snapshot are identified from one combined array each
    // so sequence numbers land correctly across the head/tail boundary (1-4 head, 5-7 tail).
    const headPlays = Array.from({ length: 4 }, (_, index) =>
      play(`head-${String(index)}`, { startYardLine: 10 + index }),
    );
    const staleTailPlays = Array.from({ length: 3 }, (_, index) =>
      play(`stale-tail-${String(index)}`, { period: 3, startYardLine: 40 + index }),
    );
    const rebuiltTailPlays = Array.from({ length: 3 }, (_, index) =>
      play(`rebuilt-tail-${String(index)}`, { period: 3, startYardLine: 60 + index }),
    );
    const oldCombined = [...headPlays, ...staleTailPlays];
    const storedHead = headPlays.map((_, index) =>
      storedFrom(oldCombined, `stored-head-${String(index)}`, index),
    );
    const storedTail = staleTailPlays.map((_, index) =>
      storedFrom(oldCombined, `stored-tail-${String(index)}`, headPlays.length + index),
    );
    return { headPlays, storedHead, storedTail, rebuiltTailPlays };
  }

  it('requires an explicit cutoffSequence', async () => {
    const { headPlays, storedHead, storedTail, rebuiltTailPlays } =
      buildTrailingDivergenceScenario();
    const { service } = harness({
      initialProviderPlays: [...headPlays, ...rebuiltTailPlays],
      initiallyStoredPlays: [...storedHead, ...storedTail],
    });
    await expect(
      service.repair({ gameId, mode: 'REBUILD_AFTER_CUTOFF', actor, reason: 'missing cutoff' }),
    ).rejects.toMatchObject({ code: 'REPAIR_CUTOFF_REQUIRED' });
  });

  it('preserves the head, supersedes (never deletes) the stale tail, and rebuilds it fresh', async () => {
    const { headPlays, storedHead, storedTail, rebuiltTailPlays } =
      buildTrailingDivergenceScenario();
    const { service, getStoredPlays, getAllRowsEverWritten, getClearPlaysBlockCalls } = harness({
      initialProviderPlays: [...headPlays, ...rebuiltTailPlays],
      initiallyStoredPlays: [...storedHead, ...storedTail],
    });
    const result = await service.repair({
      gameId,
      mode: 'REBUILD_AFTER_CUTOFF',
      actor,
      reason: 'clean cutoff after divergence',
      cutoffSequence: 4,
    });
    expect(result.applied).toBe(true);
    expect(result.supersededCount).toBe(3);
    expect(result.inserted).toBe(3);
    const active = getStoredPlays();
    // Head rows retained under their original stable ids.
    for (const headRow of storedHead)
      expect(active.some((row) => row.id === headRow.id)).toBe(true);
    // Stale tail rows are gone from the active set...
    for (const tailRow of storedTail)
      expect(active.some((row) => row.id === tailRow.id)).toBe(false);
    // ...but never deleted: they still exist, marked superseded.
    for (const tailRow of storedTail) {
      const preserved = getAllRowsEverWritten().find((row) => row.id === tailRow.id);
      expect(preserved?.supersededAt).not.toBeNull();
    }
    expect(getClearPlaysBlockCalls()).toBe(1);
  });

  it('fails closed (409 REPAIR_CUTOFF_INVALID) when a stored play at or before the cutoff is unmatched', async () => {
    const { headPlays, storedHead, storedTail, rebuiltTailPlays } =
      buildTrailingDivergenceScenario();
    // Corrupt one head row so it no longer matches anything in the fresh provider snapshot —
    // simulating state moving since the diagnostic was generated.
    const corruptedHead = storedHead.map((row, index) =>
      index === 0
        ? { ...row, playKey: 'corrupted', reconciliationKey: 'corrupted-structural' }
        : row,
    );
    const { service } = harness({
      initialProviderPlays: [...headPlays, ...rebuiltTailPlays],
      initiallyStoredPlays: [...corruptedHead, ...storedTail],
    });
    await expect(
      service.repair({
        gameId,
        mode: 'REBUILD_AFTER_CUTOFF',
        actor,
        reason: 'unsafe cutoff',
        cutoffSequence: 4,
      }),
    ).rejects.toMatchObject({ code: 'REPAIR_CUTOFF_INVALID' });
  });
});
