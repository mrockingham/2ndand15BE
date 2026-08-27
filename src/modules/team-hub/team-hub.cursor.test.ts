import { describe, expect, it } from 'vitest';

import { decodeTeamRosterCursor, encodeTeamRosterCursor } from './team-hub.cursor.js';

const teamId = '00000000-0000-4000-8000-000000000001';
const value = {
  version: 1,
  teamId,
  season: 2025,
  position: null,
  positionGroup: 'WR',
  search: null,
  sortPositionGroup: 'WR',
  sortPosition: 'WR',
  normalizedName: 'test player',
  playerId: '00000000-0000-4000-8000-000000000002',
} as const;

describe('Team roster cursor', () => {
  it('round-trips deterministic ordering fields and request context', () => {
    expect(
      decodeTeamRosterCursor(encodeTeamRosterCursor(value), teamId, {
        season: 2025,
        positionGroup: 'WR',
        limit: 25,
      }),
    ).toEqual(value);
  });

  it('rejects malformed and cross-filter cursors', () => {
    expect(() => decodeTeamRosterCursor('not-json', teamId, { season: 2025, limit: 25 })).toThrow(
      /cursor is invalid/,
    );
    expect(() =>
      decodeTeamRosterCursor(encodeTeamRosterCursor(value), teamId, {
        season: 2024,
        positionGroup: 'WR',
        limit: 25,
      }),
    ).toThrow(/cursor is invalid/);
  });
});
