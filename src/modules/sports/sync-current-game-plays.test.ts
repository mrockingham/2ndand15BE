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
});
