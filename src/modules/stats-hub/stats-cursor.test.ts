import { describe, expect, it } from 'vitest';

import { decodeStatsCursor, encodeStatsCursor } from './stats-cursor.js';

const cursor = {
  version: 1,
  context: 'SEASON',
  metric: 'passing_yards',
  value: 4500,
  games: 17,
  displayName: 'Test Player',
  playerId: '00000000-0000-4000-8000-000000000001',
  rowId: '00000000-0000-4000-8000-000000000001',
} as const;

describe('Stats Hub cursor', () => {
  it('round-trips all deterministic ordering fields', () => {
    expect(decodeStatsCursor(encodeStatsCursor(cursor), cursor)).toEqual(cursor);
  });

  it('rejects malformed and cross-context cursors', () => {
    expect(() => decodeStatsCursor('not-json', cursor)).toThrow(/cursor is invalid/);
    expect(() =>
      decodeStatsCursor(encodeStatsCursor(cursor), {
        context: 'WEEK',
        metric: 'passing_yards',
      }),
    ).toThrow(/cursor is invalid/);
  });
});
