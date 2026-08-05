import { describe, expect, it } from 'vitest';

import { compareSummaryValues } from './historical-reconciliation.js';

describe('historical season-summary reconciliation', () => {
  it('distinguishes missing from zero', () => {
    expect(compareSummaryValues(null, 0)).toBe(false);
    expect(compareSummaryValues(null, null)).toBe(true);
  });

  it('allows only floating-point representation noise', () => {
    expect(compareSummaryValues(31.66, 31.660000000000004)).toBe(true);
    expect(compareSummaryValues(31.66, 31.67)).toBe(false);
  });
});
