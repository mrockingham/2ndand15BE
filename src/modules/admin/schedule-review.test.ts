import { describe, expect, it } from 'vitest';

import type { ScheduleImportRow } from './admin.schemas.js';
import { reviewSchedule } from './schedule-review.js';

describe('reviewSchedule', () => {
  it('detects duplicate schedule identities and external references', () => {
    const row = scheduleRow();
    const review = reviewSchedule([row, row]);

    expect(review.duplicateIdentities).toHaveLength(1);
    expect(review.duplicateExternalReferences).toHaveLength(1);
    expect(review.readyForImport).toBe(false);
  });

  it('resolves documented aliases during catalog and reference review', () => {
    const review = reviewSchedule([
      scheduleRow({
        awayTeam: 'WSH',
        homeTeam: 'JAC',
        externalReference: 'nfl-2026-reg-w01-was-jax',
      }),
    ]);

    expect(review.unknownTeams).toEqual([]);
    expect(review.unstableExternalReferences).toEqual([]);
  });

  it('reports explicit offsets, optional fields, notes, and neutral international games', () => {
    const review = reviewSchedule([
      scheduleRow({
        awayTeam: 'SF',
        homeTeam: 'LAR',
        startTime: '2026-09-11T00:35:00Z',
        venueName: 'Melbourne Cricket Ground',
        venueCity: 'Melbourne, Australia',
        broadcastNetwork: 'Netflix',
        isNeutralSite: true,
        externalReference: 'nfl-2026-reg-w01-sf-lar',
        notes: 'International game.',
      }),
      scheduleRow({
        week: 2,
        awayTeam: 'BUF',
        homeTeam: 'MIA',
        startTime: '2026-09-20T13:00:00-04:00',
        externalReference: 'nfl-2026-reg-w02-buf-mia',
      }),
    ]);

    expect(review.invalidOffsets).toEqual([]);
    expect(review.invalidTimestamps).toEqual([]);
    expect(review.neutralSiteGames).toHaveLength(1);
    expect(review.internationalGames).toHaveLength(1);
    expect(review.rowsWithNotes).toHaveLength(1);
    expect(review.missingVenueCount).toBe(1);
    expect(review.missingBroadcastCount).toBe(1);
  });

  it('detects a team appearing twice in the same regular-season week', () => {
    const review = reviewSchedule([
      scheduleRow(),
      scheduleRow({
        awayTeam: 'PHI',
        homeTeam: 'DAL',
        externalReference: 'nfl-2026-reg-w01-phi-dal',
      }),
    ]);

    expect(review.teamsPlayingTwiceInWeek).toHaveLength(1);
    expect(review.teamsPlayingTwiceInWeek[0]?.row).toBe(3);
    expect(review.teamsPlayingTwiceInWeek[0]?.message).toContain('DAL');
  });

  it('treats an explicit TBD kickoff as unresolved rather than an invented timestamp', () => {
    const review = reviewSchedule([scheduleRow({ startTime: 'TBD' })]);

    expect(review.tbdKickoffs).toHaveLength(1);
    expect(review.invalidTimestamps).toEqual([]);
    expect(review.invalidOffsets).toEqual([]);
    expect(review.warnings).toContain('1 rows have an explicitly unresolved kickoff (TBD).');
  });
});

function scheduleRow(overrides: Partial<ScheduleImportRow> = {}): ScheduleImportRow {
  return {
    season: 2026,
    seasonType: 'REG',
    week: 1,
    startTime: '2026-09-13T20:25:00Z',
    awayTeam: 'WAS',
    homeTeam: 'DAL',
    status: 'SCHEDULED',
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: false,
    sourceName: 'NFL.com 2026 Schedule',
    sourceType: 'OFFICIAL_WEB',
    sourceUrl: 'https://www.nfl.com/schedules/2026/by-week/week-1',
    externalReference: 'nfl-2026-reg-w01-was-dal',
    notes: null,
    ...overrides,
  };
}
