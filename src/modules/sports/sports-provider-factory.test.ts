import { describe, expect, it } from 'vitest';

import type { SportsConfig } from '../../config/env.js';
import { ApiSportsDataProvider } from './providers/api-sports/api-sports-data-provider.js';
import { MockSportsDataProvider } from './providers/mock/mock-sports-data-provider.js';
import { createSportsDataProvider } from './sports-provider-factory.js';

const apiSports: SportsConfig['apiSports'] = {
  baseUrl: 'https://example.test',
  apiKey: null,
  requestTimeoutMs: 1_000,
  maxRetries: 0,
  syncSeason: 2024,
  syncSeasonType: null,
  storeLogoUrls: false,
};
const gameSafety = {
  currentNflSeason: 2026,
  allowHistoricalDefaultGameResults: false,
  fixtureDataEnabled: false,
} as const;

describe('createSportsDataProvider', () => {
  it('uses the mock provider by default configuration', () => {
    expect(createSportsDataProvider({ provider: 'mock', apiSports, ...gameSafety })).toBeInstanceOf(
      MockSportsDataProvider,
    );
  });

  it('uses API-Sports only when it is selected and configured', () => {
    expect(
      createSportsDataProvider({
        provider: 'api-sports',
        apiSports: { ...apiSports, apiKey: 'test-key' },
        ...gameSafety,
      }),
    ).toBeInstanceOf(ApiSportsDataProvider);
    expect(() =>
      createSportsDataProvider({ provider: 'api-sports', apiSports, ...gameSafety }),
    ).toThrow('SPORTS_API is required');
  });
});
