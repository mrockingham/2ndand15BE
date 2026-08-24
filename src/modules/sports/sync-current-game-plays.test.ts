import { describe, expect, it } from 'vitest';

import type { GamePlay } from '../../generated/prisma/client.js';
import type { NormalizedCurrentGamePlay } from './current-game-play-provider.js';
import type { CurrentGamePlayTarget } from './current-game-play.repository.js';
import { identifyPlays, reconcilePlays } from './sync-current-game-plays.js';

const target: CurrentGamePlayTarget = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'FINAL',
  homeTeamId: '00000000-0000-4000-8000-000000000002',
  awayTeamId: '00000000-0000-4000-8000-000000000003',
  homeAbbreviation: 'LAC',
  awayAbbreviation: 'SF',
  providerMapping: { providerGameId: '565939' },
  plays: [],
};
const snapshot = { homeProviderTeamId: '1', awayProviderTeamId: '2' };

function play(description: string): NormalizedCurrentGamePlay {
  return {
    providerOrder: 0,
    period: 1,
    clock: '9:01',
    possessionProviderTeamId: '2',
    playType: 'PASS',
    sourcePlayType: 'Pass Reception',
    description,
    startDown: 1,
    startDistance: 10,
    startYardLine: 25,
    endDown: 1,
    endDistance: 10,
    endYardLine: 35,
    isScoringPlay: false,
    isPenalty: false,
    isTurnover: false,
    fieldPositionFailure: false,
  };
}

function stored(row: ReturnType<typeof identifyPlays>['plays'][number], id: string): GamePlay {
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

function requiredPlay(
  value: ReturnType<typeof identifyPlays>['plays'][number] | undefined,
): ReturnType<typeof identifyPlays>['plays'][number] {
  if (value === undefined) throw new Error('Expected an identified play.');
  return value;
}

describe('current game play identity and reconciliation', () => {
  it('creates stable keys and disambiguates repeated identical plays by occurrence', () => {
    const first = identifyPlays(
      target.id,
      'highlightly',
      [play('same'), play('same')],
      snapshot,
      target,
    );
    const replay = identifyPlays(
      target.id,
      'highlightly',
      [play('same'), play('same')],
      snapshot,
      target,
    );
    expect(first.plays.map((value) => value.playKey)).toEqual(
      replay.plays.map((value) => value.playKey),
    );
    expect(new Set(first.plays.map((value) => value.playKey)).size).toBe(2);
    expect(first.duplicateSignatures).toBe(1);
  });

  it('reconciles a corrected description through the structural key', () => {
    const original = requiredPlay(
      identifyPlays(target.id, 'highlightly', [play('original')], snapshot, target).plays[0],
    );
    const corrected = requiredPlay(
      identifyPlays(target.id, 'highlightly', [play('corrected')], snapshot, target).plays[0],
    );
    const plan = reconcilePlays(
      [corrected],
      [stored(original, '00000000-0000-4000-8000-000000000004')],
      new Date(),
    );
    expect(plan).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, unmatchedExisting: 0 });
    expect(plan.rows[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000004',
      description: 'corrected',
    });
  });

  it('reports unmatched stored rows instead of deleting a shorter snapshot', () => {
    const identified = identifyPlays(
      target.id,
      'highlightly',
      [play('one'), play('two')],
      snapshot,
      target,
    ).plays;
    const plan = reconcilePlays(
      [requiredPlay(identified[0])],
      identified.map((row, index) =>
        stored(row, `00000000-0000-4000-8000-00000000000${String(index + 4)}`),
      ),
      new Date(),
    );
    expect(plan.unmatchedExisting).toBe(1);
  });

  describe('manual links and diagnostic detail (M27.1)', () => {
    const desired = requiredPlay(
      identifyPlays(target.id, 'highlightly', [play('corrected')], snapshot, target).plays[0],
    );
    const candidateBase = requiredPlay(
      identifyPlays(target.id, 'highlightly', [play('original')], snapshot, target).plays[0],
    );
    // Two existing rows sharing a structural (reconciliation) key but distinct play keys, so the
    // corrected desired play falls through to structural matching and finds an ambiguous pair.
    function collisionCandidates(): readonly [
      ReturnType<typeof stored>,
      ReturnType<typeof stored>,
    ] {
      const candidateA = stored(candidateBase, 'candidate-a');
      const candidateB = {
        ...stored(candidateBase, 'candidate-b'),
        playKey: 'a-distinct-play-key',
      };
      return [candidateA, candidateB];
    }

    it('omits collisionDetails/unmatchedExistingRows by default (byte-identical to pre-M27.1 behavior)', () => {
      const plan = reconcilePlays([desired], collisionCandidates(), new Date());
      expect(plan.collisions).toBe(1);
      expect(plan.collisionDetails).toBeUndefined();
      expect(plan.unmatchedExistingRows).toBeUndefined();
      expect(Object.keys(plan)).toEqual([
        'rows',
        'inserted',
        'updated',
        'unchanged',
        'reordered',
        'collisions',
        'unresolved',
        'unmatchedExisting',
      ]);
    });

    it('populates collisionDetails and unmatchedExistingRows when includeDiagnosticDetail is requested', () => {
      const candidates = collisionCandidates();
      const plan = reconcilePlays([desired], candidates, new Date(), {
        includeDiagnosticDetail: true,
      });
      expect(plan.collisions).toBe(1);
      expect(plan.collisionDetails).toHaveLength(1);
      expect(plan.collisionDetails?.[0]?.candidates).toHaveLength(2);
      expect(plan.collisionDetails?.[0]?.desiredSequence).toBe(desired.sequence);
      expect(plan.unmatchedExistingRows).toEqual(expect.arrayContaining([...candidates]));
    });

    it('resolves a collision via an operator-supplied manual link', () => {
      const [candidateA, candidateB] = collisionCandidates();
      const plan = reconcilePlays([desired], [candidateA, candidateB], new Date(), {
        manualLinks: [{ existingPlayId: candidateA.id, desiredSequence: desired.sequence }],
      });
      expect(plan.collisions).toBe(0);
      expect(plan.unmatchedExisting).toBe(1);
      expect(plan.rows[0]).toMatchObject({ id: candidateA.id, description: 'corrected' });
    });

    it('ignores an invalid manual link (unknown existing id) and falls through to collision detection', () => {
      const [candidateA, candidateB] = collisionCandidates();
      const plan = reconcilePlays([desired], [candidateA, candidateB], new Date(), {
        manualLinks: [{ existingPlayId: 'does-not-exist', desiredSequence: desired.sequence }],
      });
      expect(plan.collisions).toBe(1);
    });

    it('ignores a manual link pointing at an already-used existing row', () => {
      const [candidateA, candidateB] = collisionCandidates();
      const plan = reconcilePlays([desired], [candidateA, candidateB], new Date(), {
        manualLinks: [
          { existingPlayId: candidateA.id, desiredSequence: desired.sequence },
          { existingPlayId: candidateA.id, desiredSequence: desired.sequence + 1 },
        ],
      });
      // The second link targets a sequence that doesn't exist in `desired`, so it never applies;
      // the first link still resolves the only real desired play cleanly.
      expect(plan.collisions).toBe(0);
      expect(plan.rows).toHaveLength(1);
    });
  });
});
