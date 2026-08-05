import { describe, expect, it } from 'vitest';

import { buildHistoricalImportLeaseKey } from './historical.repository.js';

describe('historical import lease identity', () => {
  it('is scoped to dataset and season instead of a particular release', () => {
    expect(buildHistoricalImportLeaseKey({ dataset: 'PLAYER_STATS', season: 2025 })).toBe(
      'PLAYER_STATS:2025',
    );
    expect(buildHistoricalImportLeaseKey({ dataset: 'PLAYERS', season: null })).toBe(
      'PLAYERS:global',
    );
  });
});
