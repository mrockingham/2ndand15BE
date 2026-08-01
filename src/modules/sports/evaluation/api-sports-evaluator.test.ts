import { describe, expect, it } from 'vitest';

import { mockNflGamesFixture } from '../providers/mock/nfl-games.fixture.js';
import { mockNflTeamsFixture } from '../providers/mock/nfl-teams.fixture.js';
import type { SportsDataProvider } from '../sports-data-provider.js';
import { ApiSportsEvaluator } from './api-sports-evaluator.js';

describe('ApiSportsEvaluator', () => {
  it('evaluates historical availability while failing unavailable current-season suitability', async () => {
    const historical = mockNflGamesFixture.filter((game) => game.seasonType === 'REG').slice(0, 2);
    const provider: SportsDataProvider = {
      getTeams: () =>
        Promise.resolve({
          provider: 'api-sports',
          received: 32,
          records: mockNflTeamsFixture,
          failures: [],
        }),
      getGames: (query) => {
        if (query.season === 2025) return Promise.reject(new Error('Unavailable'));
        const records = query.season === 2024 ? historical : [];
        return Promise.resolve({
          provider: 'api-sports',
          received: records.length,
          records,
          failures: query.season === 2024 ? [{ providerRecordId: null, reason: 'Invalid' }] : [],
        });
      },
      getGameByProviderId: () => Promise.resolve(null),
    };

    const report = await new ApiSportsEvaluator({
      provider,
      seasons: [2024, 2025, 2026],
      currentSeason: 2026,
      now: () => new Date('2026-08-01T12:00:00.000Z'),
    }).evaluate();

    expect(report.availableNflSeasons.value).toEqual([2024]);
    expect(report.currentSeasonAvailability).toMatchObject({ state: 'verified', value: false });
    expect(report.teamCount.value).toBe(32);
    expect(report.gameCountBySeasonType['2024']?.REG.value).toBe(2);
    expect(report.gameCountBySeasonType['2025']?.REG.state).toBe('unavailable');
    expect(report.playByPlayEndpointAvailability.state).toBe('untested');
    expect(report.estimatedRequestCount).toBe(4);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'pass', code: 'HISTORICAL_DATA_SUITABILITY' }),
        expect.objectContaining({ level: 'failure', code: 'CURRENT_SEASON_SUITABILITY' }),
        expect.objectContaining({ level: 'warning', code: 'RECORD_VALIDATION' }),
      ]),
    );
  });
});
