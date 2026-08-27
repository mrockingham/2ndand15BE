import { describe, expect, it } from 'vitest';

import type { GamePlay } from '../../generated/prisma/client.js';
import type {
  CurrentGamePlayBatch,
  CurrentGamePlayProvider,
  NormalizedCurrentGamePlay,
} from './current-game-play-provider.js';
import type {
  CurrentGamePlayFinalReplaceInput,
  CurrentGamePlayRepository,
  CurrentGamePlayTarget,
} from './current-game-play.repository.js';
import {
  computeFinalSnapshotFingerprint,
  FinalPlaySnapshotService,
  validateFinalSnapshot,
} from './current-game-play-final-replacement.js';
import { identifyPlays, type IdentifiedPlay } from './sync-current-game-plays.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const homeTeamId = '00000000-0000-4000-8000-000000000002';
const awayTeamId = '00000000-0000-4000-8000-000000000003';
const snapshot = { homeProviderTeamId: 'home-provider', awayProviderTeamId: 'away-provider' };
const finalTarget: Omit<CurrentGamePlayTarget, 'plays'> = {
  id: gameId,
  status: 'FINAL',
  homeTeamId,
  awayTeamId,
  homeAbbreviation: 'NE',
  awayAbbreviation: 'PHI',
  providerMapping: { providerGameId: '565939' },
};

function play(
  description: string,
  overrides: { readonly period?: number; readonly startYardLine?: number } = {},
): NormalizedCurrentGamePlay {
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

function identify(plays: readonly NormalizedCurrentGamePlay[]): readonly IdentifiedPlay[] {
  return identifyPlays(gameId, 'highlightly', plays, snapshot, { ...finalTarget, plays: [] }).plays;
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

describe('validateFinalSnapshot', () => {
  it('accepts a normal non-empty snapshot with no active rows yet', () => {
    const identified = identify([play('one'), play('two')]);
    expect(validateFinalSnapshot(identified, 0)).toEqual({
      valid: true,
      reason: null,
      noopEmpty: false,
    });
  });

  it('treats an empty snapshot against zero active rows as a no-op, not an error', () => {
    expect(validateFinalSnapshot([], 0)).toEqual({ valid: true, reason: null, noopEmpty: true });
  });

  it('rejects an empty snapshot when live plays are currently active', () => {
    const result = validateFinalSnapshot([], 87);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it('rejects a plausibility violation: FINAL smaller than active', () => {
    const identified = identify(
      Array.from({ length: 5 }, (_, index) =>
        play(`play-${String(index)}`, { startYardLine: 10 + index }),
      ),
    );
    const result = validateFinalSnapshot(identified, 87);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/smaller/i);
  });

  it('accepts a PHI@NE-shaped snapshot: 184 final plays against 87 active', () => {
    const identified = identify(
      Array.from({ length: 184 }, (_, index) =>
        play(`play-${String(index)}`, { startYardLine: (index % 90) + 1 }),
      ),
    );
    expect(validateFinalSnapshot(identified, 87)).toEqual({
      valid: true,
      reason: null,
      noopEmpty: false,
    });
  });

  it('accepts final count exactly equal to active count', () => {
    const identified = identify(
      Array.from({ length: 10 }, (_, index) =>
        play(`play-${String(index)}`, { startYardLine: 10 + index }),
      ),
    );
    expect(validateFinalSnapshot(identified, 10).valid).toBe(true);
  });
});

describe('computeFinalSnapshotFingerprint', () => {
  it('is identical for the same content regardless of id, provider id, or timestamps', () => {
    const identified = identify([play('one'), play('two')]);
    const storedRows = identified.map((row, index) => stored(row, `id-${String(index)}`));
    const storedRowsDifferentIdsAndTimestamps = identified.map((row, index) => ({
      ...stored(row, `different-id-${String(index)}`),
      sourceUpdatedAt: new Date('2099-01-01T00:00:00Z'),
      createdAt: new Date('2099-01-01T00:00:00Z'),
    }));
    expect(computeFinalSnapshotFingerprint(storedRows)).toBe(
      computeFinalSnapshotFingerprint(storedRowsDifferentIdsAndTimestamps),
    );
  });

  it('is identical between a freshly-identified snapshot and the stored rows derived from it', () => {
    const identified = identify([play('one'), play('two')]);
    const storedRows = identified.map((row, index) => stored(row, `id-${String(index)}`));
    expect(computeFinalSnapshotFingerprint(identified)).toBe(
      computeFinalSnapshotFingerprint(storedRows),
    );
  });

  it('changes when play content changes', () => {
    const first = identify([play('one'), play('two')]);
    const second = identify([play('one'), play('corrected two')]);
    expect(computeFinalSnapshotFingerprint(first)).not.toBe(
      computeFinalSnapshotFingerprint(second),
    );
  });

  it('is order-independent (sorts by sequence internally)', () => {
    const identified = identify([play('one'), play('two')]);
    const reversed = [...identified].reverse();
    expect(computeFinalSnapshotFingerprint(identified)).toBe(
      computeFinalSnapshotFingerprint(reversed),
    );
  });
});

function harness(options: {
  readonly initiallyActivePlays?: readonly GamePlay[];
  readonly providerPlays: readonly NormalizedCurrentGamePlay[];
  readonly targetStatus?: CurrentGamePlayTarget['status'];
}) {
  let activePlays: readonly GamePlay[] = options.initiallyActivePlays ?? [];
  const replaceWithAuthoritativeFinalSnapshot = (input: CurrentGamePlayFinalReplaceInput) => {
    activePlays = input.rows.map(
      (row, index) => ({ ...row, id: `final-${String(index)}` }) as GamePlay,
    );
    return Promise.resolve({ auditEventId: 'audit-event-final' });
  };
  const playRepository: CurrentGamePlayRepository = {
    findTarget: () =>
      Promise.resolve<CurrentGamePlayTarget>({
        ...finalTarget,
        status: options.targetStatus ?? 'FINAL',
        plays: activePlays,
      }),
    applySnapshot: () => Promise.reject(new Error('not exercised')),
    applyRepair: () => Promise.reject(new Error('not exercised')),
    replaceWithAuthoritativeFinalSnapshot,
  };
  const batch: CurrentGamePlayBatch = {
    provider: 'highlightly',
    record: {
      provider: 'highlightly',
      providerGameId: '565939',
      homeProviderTeamId: snapshot.homeProviderTeamId,
      awayProviderTeamId: snapshot.awayProviderTeamId,
      homeAbbreviation: 'NE',
      awayAbbreviation: 'PHI',
      plays: options.providerPlays,
      providerUpdatedAt: null,
    },
    failures: [],
    requestsUsed: 1,
    responseDurationMs: 5,
    normalizationDurationMs: 1,
  };
  const playProvider: CurrentGamePlayProvider = {
    providerKey: 'highlightly',
    getGamePlays: () => Promise.resolve(batch),
  };
  const service = new FinalPlaySnapshotService(
    playProvider,
    playRepository,
    () => new Date('2026-08-23T03:00:00Z'),
  );
  return { service, getActivePlays: () => activePlays, batch };
}

describe('FinalPlaySnapshotService.replace', () => {
  it('replaces: supersedes active rows and installs the FINAL snapshot fresh (fetch path)', async () => {
    const activeLive = identify([play('live one')]).map((row, index) =>
      stored(row, `live-${String(index)}`),
    );
    const { service, getActivePlays } = harness({
      initiallyActivePlays: activeLive,
      providerPlays: [play('final one'), play('final two', { startYardLine: 50 })],
    });
    const result = await service.replace({
      gameId,
      phase: 'FINAL_IMMEDIATE',
      actorEmailSnapshot: 'test-actor',
    });
    expect(result.status).toBe('REPLACED');
    if (result.status !== 'REPLACED') throw new Error('expected REPLACED');
    expect(result.priorActiveCount).toBe(1);
    expect(result.newActiveCount).toBe(2);
    expect(result.supersededCount).toBe(1);
    expect(getActivePlays()).toHaveLength(2);
    expect(getActivePlays().every((row) => row.id.startsWith('final-'))).toBe(true);
  });

  it('reuses a poller-supplied snapshot without calling the provider again', async () => {
    const getGamePlays = () => Promise.reject(new Error('should not be called'));
    const playRepository: CurrentGamePlayRepository = {
      findTarget: () => Promise.resolve<CurrentGamePlayTarget>({ ...finalTarget, plays: [] }),
      applySnapshot: () => Promise.reject(new Error('not exercised')),
      applyRepair: () => Promise.reject(new Error('not exercised')),
      replaceWithAuthoritativeFinalSnapshot: () =>
        Promise.resolve({ auditEventId: 'audit-event-final' }),
    };
    const service = new FinalPlaySnapshotService(
      { providerKey: 'highlightly', getGamePlays },
      playRepository,
    );
    const result = await service.replace({
      gameId,
      phase: 'FINAL_IMMEDIATE',
      actorEmailSnapshot: 'test-actor',
      playsSnapshot: {
        provider: 'highlightly',
        providerGameId: '565939',
        homeProviderTeamId: snapshot.homeProviderTeamId,
        awayProviderTeamId: snapshot.awayProviderTeamId,
        homeAbbreviation: 'NE',
        awayAbbreviation: 'PHI',
        plays: [play('final one')],
        providerUpdatedAt: null,
      },
    });
    expect(result.status).toBe('REPLACED');
  });

  it('is idempotent: an identical FINAL snapshot is a no-op, not a re-supersede', async () => {
    const activeFinal = identify([play('final one'), play('final two', { startYardLine: 50 })]).map(
      (row, index) => stored(row, `final-existing-${String(index)}`),
    );
    const { service, getActivePlays } = harness({
      initiallyActivePlays: activeFinal,
      providerPlays: [play('final one'), play('final two', { startYardLine: 50 })],
    });
    const result = await service.replace({
      gameId,
      phase: 'FINAL_10',
      actorEmailSnapshot: 'test-actor',
    });
    expect(result.status).toBe('NOOP_UNCHANGED');
    if (result.status !== 'NOOP_UNCHANGED') throw new Error('expected NOOP_UNCHANGED');
    expect(result.activeCount).toBe(2);
    // Confirms nothing was written: the original ids are still there, untouched.
    expect(getActivePlays()).toEqual(activeFinal);
  });

  it('a corrected +10 snapshot replaces the FINAL_IMMEDIATE rows', async () => {
    const activeFinal = identify([play('final one')]).map((row, index) =>
      stored(row, `final-existing-${String(index)}`),
    );
    const { service, getActivePlays } = harness({
      initiallyActivePlays: activeFinal,
      providerPlays: [play('final one'), play('a corrected addition', { startYardLine: 60 })],
    });
    const result = await service.replace({
      gameId,
      phase: 'FINAL_10',
      actorEmailSnapshot: 'test-actor',
    });
    expect(result.status).toBe('REPLACED');
    expect(getActivePlays()).toHaveLength(2);
  });

  it('validation failure leaves the active snapshot completely untouched and writes nothing', async () => {
    const activeLive = identify(
      Array.from({ length: 5 }, (_, index) =>
        play(`live-${String(index)}`, { startYardLine: 10 + index }),
      ),
    ).map((row, index) => stored(row, `live-${String(index)}`));
    const { service, getActivePlays } = harness({
      initiallyActivePlays: activeLive,
      providerPlays: [play('too few')],
    });
    const result = await service.replace({
      gameId,
      phase: 'FINAL_IMMEDIATE',
      actorEmailSnapshot: 'test-actor',
    });
    expect(result.status).toBe('VALIDATION_FAILED');
    if (result.status !== 'VALIDATION_FAILED') throw new Error('expected VALIDATION_FAILED');
    expect(result.reasonCode).toBe('FINAL_SNAPSHOT_INVALID');
    expect(getActivePlays()).toEqual(activeLive);
  });

  it('rejects a game that is not yet FINAL (defense in depth for the standalone/CLI path)', async () => {
    const { service } = harness({ providerPlays: [play('one')], targetStatus: 'IN_PROGRESS' });
    await expect(
      service.replace({ gameId, phase: 'FINAL_IMMEDIATE', actorEmailSnapshot: 'test-actor' }),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FINAL' });
  });

  it('rejects an identity mismatch between the provider snapshot and the verified game', async () => {
    const playRepository: CurrentGamePlayRepository = {
      findTarget: () => Promise.resolve<CurrentGamePlayTarget>({ ...finalTarget, plays: [] }),
      applySnapshot: () => Promise.reject(new Error('not exercised')),
      applyRepair: () => Promise.reject(new Error('not exercised')),
      replaceWithAuthoritativeFinalSnapshot: () =>
        Promise.reject(new Error('should not be called')),
    };
    const batch: CurrentGamePlayBatch = {
      provider: 'highlightly',
      record: {
        provider: 'highlightly',
        providerGameId: '565939',
        homeProviderTeamId: snapshot.homeProviderTeamId,
        awayProviderTeamId: snapshot.awayProviderTeamId,
        homeAbbreviation: 'MIA',
        awayAbbreviation: 'BUF',
        plays: [play('one')],
        providerUpdatedAt: null,
      },
      failures: [],
      requestsUsed: 1,
      responseDurationMs: 5,
      normalizationDurationMs: 1,
    };
    const service = new FinalPlaySnapshotService(
      { providerKey: 'highlightly', getGamePlays: () => Promise.resolve(batch) },
      playRepository,
    );
    await expect(
      service.replace({ gameId, phase: 'FINAL_IMMEDIATE', actorEmailSnapshot: 'test-actor' }),
    ).rejects.toMatchObject({ code: 'CURRENT_GAME_PLAYS_IDENTITY_MISMATCH' });
  });
});
