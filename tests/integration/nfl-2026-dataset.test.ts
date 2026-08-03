import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readScheduleImportFile } from '../../src/modules/admin/schedule-csv.js';
import { reviewSchedule } from '../../src/modules/admin/schedule-review.js';

const datasetPath = resolve('data/schedules/nfl-2026.csv');

describe('the reviewed NFL 2026 schedule dataset', () => {
  it('passes all aggregate coverage gates with explicit TBD semantics', async () => {
    const rows = await readScheduleImportFile(datasetPath);
    const review = reviewSchedule(rows);

    expect(rows).toHaveLength(320);
    expect(review.countsBySeasonType).toEqual({ PRE: 48, REG: 272 });
    expect(review.teamsRepresented).toHaveLength(32);
    expect(review.duplicateIdentities).toEqual([]);
    expect(review.duplicateExternalReferences).toEqual([]);
    expect(review.unstableExternalReferences).toEqual([]);
    expect(review.unknownTeams).toEqual([]);
    expect(review.sameTeamGames).toEqual([]);
    expect(review.teamsPlayingTwiceInWeek).toEqual([]);
    expect(review.invalidTimestamps).toEqual([]);
    expect(review.invalidOffsets).toEqual([]);
    expect(Object.values(review.byeWeekPerTeam).every((week) => week !== null)).toBe(true);
    expect(review.tbdKickoffs).toHaveLength(24);
    expect(review.blockers).toEqual([]);
    expect(review.readyForImport).toBe(true);
  });

  it('preserves reviewed DST and international kickoff samples', async () => {
    const rows = await readScheduleImportFile(datasetPath);
    const find = (externalReference: string) =>
      rows.find((row) => row.externalReference === externalReference);

    expect(find('nfl-2026-reg-w01-sf-lar')).toMatchObject({
      startTime: '2026-09-11T00:35:00Z',
      venueName: 'Melbourne Cricket Ground',
      venueCity: 'Melbourne, Australia',
      broadcastNetwork: 'Netflix',
      isNeutralSite: true,
    });
    expect(find('nfl-2026-reg-w03-bal-dal')?.startTime).toBe('2026-09-27T20:25:00Z');
    expect(find('nfl-2026-reg-w07-pit-no')?.startTime).toBe('2026-10-25T13:30:00Z');
    expect(find('nfl-2026-reg-w09-cin-atl')?.startTime).toBe('2026-11-08T14:30:00Z');
    expect(find('nfl-2026-reg-w11-min-sf')?.startTime).toBe('2026-11-23T01:20:00Z');
  });

  it('uses canonical aliases and stable human-reviewable references', async () => {
    const rows = await readScheduleImportFile(datasetPath);
    const teams = new Set(rows.flatMap((row) => [row.awayTeam, row.homeTeam]));

    expect(teams.has('WSH')).toBe(false);
    expect(teams.has('JAC')).toBe(false);
    expect(teams.has('LA')).toBe(false);
    expect(teams.has('AZ')).toBe(false);
    expect(teams.has('WAS')).toBe(true);
    expect(teams.has('JAX')).toBe(true);
    expect(teams.has('LAR')).toBe(true);
    expect(teams.has('LAC')).toBe(true);
    expect(rows.every((row) => row.externalReference?.startsWith('nfl-2026-'))).toBe(true);
  });
});
