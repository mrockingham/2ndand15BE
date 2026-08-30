import { describe, expect, it } from 'vitest';

import { powerRankingEditionCreateSchema } from './power-ranking.schemas.js';

describe('powerRankingEditionCreateSchema asOf', () => {
  it('accepts a bare editorial date and normalizes it to midnight UTC', () => {
    const result = powerRankingEditionCreateSchema.parse({
      season: 2026,
      edition: 'preseason',
      title: 'Fictional Power Rankings',
      asOf: '2026-08-30',
      methodology: 'A fictional methodology.',
    });
    expect(result.asOf).toBe('2026-08-30T00:00:00.000Z');
  });

  it('still accepts a full ISO datetime with offset', () => {
    const result = powerRankingEditionCreateSchema.parse({
      season: 2026,
      edition: 'preseason',
      title: 'Fictional Power Rankings',
      asOf: '2026-08-30T12:34:56.000Z',
      methodology: 'A fictional methodology.',
    });
    expect(result.asOf).toBe('2026-08-30T12:34:56.000Z');
  });

  it('rejects a malformed date', () => {
    expect(() =>
      powerRankingEditionCreateSchema.parse({
        season: 2026,
        edition: 'preseason',
        title: 'Fictional Power Rankings',
        asOf: 'not-a-date',
        methodology: 'A fictional methodology.',
      }),
    ).toThrow();
  });
});
