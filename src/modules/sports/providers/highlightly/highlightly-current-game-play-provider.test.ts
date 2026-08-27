import { describe, expect, it } from 'vitest';

import type { HighlightlyDetailedMatch } from '../../evaluation/highlightly/highlightly-schemas.js';
import {
  normalizeHighlightlyCurrentGamePlays,
  normalizeHighlightlyPlayType,
  normalizeHighlightlyYardLine,
} from './highlightly-current-game-play-provider.js';

describe('Highlightly current game play normalization', () => {
  it('preserves provider order and normalizes safe semantics', () => {
    const detail = {
      id: 565939,
      date: '2026-08-16T00:00:00Z',
      league: 'NFL',
      season: 2026,
      round: 'Preseason 2',
      state: { description: 'Final', clock: null, score: null },
      homeTeam: { id: 1, name: 'Chargers', abbreviation: 'LAC' },
      awayTeam: { id: 2, name: '49ers', abbreviation: 'SF' },
      events: [
        {
          result: null,
          description: null,
          team: { id: 2, name: '49ers', abbreviation: 'SF' },
          playDetails: [
            {
              start: {
                down: 1,
                distance: 10,
                yardLine: 75,
                possessionText: 'SF 25',
                yardsToEndzone: 75,
              },
              end: {
                down: 1,
                distance: 10,
                yardLine: 65,
                possessionText: 'SF 35',
                yardsToEndzone: 65,
              },
              text: '  A   normalized play  ',
              type: 'Pass Reception',
              clock: '09:01',
              period: 1,
              isPenalty: false,
            },
            {
              start: {
                down: null,
                distance: null,
                yardLine: null,
                possessionText: null,
                yardsToEndzone: 0,
              },
              end: {
                down: null,
                distance: null,
                yardLine: null,
                possessionText: null,
                yardsToEndzone: 101,
              },
              text: 'Pick six',
              type: 'Interception Return Touchdown',
              clock: '0:04',
              period: 1,
              isPenalty: false,
            },
          ],
        },
      ],
    } as HighlightlyDetailedMatch;

    const result = normalizeHighlightlyCurrentGamePlays(detail);
    expect(result.plays).toHaveLength(2);
    expect(result.plays[0]).toMatchObject({
      providerOrder: 0,
      possessionProviderTeamId: '2',
      playType: 'PASS',
      description: 'A normalized play',
      startYardLine: 25,
      endYardLine: 35,
    });
    expect(result.plays[1]).toMatchObject({
      providerOrder: 1,
      playType: 'INTERCEPTION',
      isScoringPlay: true,
      isTurnover: true,
      startYardLine: 100,
      endYardLine: null,
      fieldPositionFailure: true,
    });
  });

  it('maps unknown types to OTHER and retains null field position', () => {
    expect(normalizeHighlightlyPlayType('Something New')).toBe('OTHER');
    expect(normalizeHighlightlyYardLine(null)).toBeNull();
    expect(normalizeHighlightlyYardLine(100)).toBe(0);
  });
});
