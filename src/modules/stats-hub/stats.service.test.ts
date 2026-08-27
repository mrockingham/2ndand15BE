import { describe, expect, it, vi } from 'vitest';

import type { StatsHubRepository } from './stats.repository.js';
import { StatsHubService } from './stats.service.js';

const playerId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';

function repository(overrides: Partial<StatsHubRepository> = {}): StatsHubRepository {
  return {
    findMetadata: vi.fn().mockResolvedValue({
      seasons: [2020, 2021, 2022, 2023, 2024, 2025],
      positions: ['QB', 'WR'],
      positionGroups: ['QB', 'WR'],
    }),
    seasonExists: vi.fn().mockResolvedValue(true),
    teamExists: vi.fn().mockResolvedValue(true),
    findPlayer: vi.fn().mockResolvedValue({
      id: playerId,
      displayName: 'Test Player',
      position: 'WR',
      positionGroup: 'WR',
      headshotUrl: null,
    }),
    findSeasonLeaders: vi.fn().mockResolvedValue({ rows: [], hasMore: false }),
    findWeeklyLeaders: vi.fn().mockResolvedValue({ rows: [], hasMore: false }),
    findRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('Stats Hub service', () => {
  it('returns stable public metadata without storage details', async () => {
    const result = await new StatsHubService(repository()).getMetadata();
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({
      data: {
        apiVersion: '1.0',
        availableSeasons: [2020, 2021, 2022, 2023, 2024, 2025],
        categories: [
          { id: 'PASSING' },
          { id: 'RUSHING' },
          { id: 'RECEIVING' },
          { id: 'DEFENSE' },
          { id: 'KICKING' },
        ],
      },
      meta: { attribution: { source: 'nflverse', license: 'CC BY 4.0' } },
    });
    expect(serialized).not.toMatch(/sourceField|seasonFields|checksum|externalId|filePath/);
  });

  it('passes exact season filters and produces a context-bound next cursor', async () => {
    const findSeasonLeaders = vi.fn().mockResolvedValue({
      rows: [rankedSeasonRow()],
      hasMore: true,
    });
    const result = await new StatsHubService(repository({ findSeasonLeaders })).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'passing_yards',
      teamId,
      position: 'QB',
      limit: 1,
    });
    expect(findSeasonLeaders).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'passing_yards' }),
      expect.objectContaining({ season: 2025, seasonType: 'REG', teamId, position: 'QB' }),
    );
    expect(result).toMatchObject({
      data: [{ rank: 1, tied: true, metricValue: 4500 }],
      meta: { metric: { id: 'passing_yards' }, ranking: { method: 'COMPETITION' } },
    });
    expect(JSON.stringify(result)).not.toContain('rowId');
    expect((result as { meta: { nextCursor: string | null } }).meta.nextCursor).not.toBeNull();
  });

  it('rejects unknown metrics, unavailable seasons, teams, and positions', async () => {
    const base = { season: 2025, seasonType: 'REG' as const, limit: 25 };
    await expect(
      new StatsHubService(repository()).getSeasonLeaders({
        ...base,
        metric: 'raw_database_column',
      }),
    ).rejects.toMatchObject({ code: 'STATS_METRIC_NOT_FOUND' });
    await expect(
      new StatsHubService(
        repository({ seasonExists: vi.fn().mockResolvedValue(false) }),
      ).getSeasonLeaders({
        ...base,
        metric: 'passing_yards',
      }),
    ).rejects.toMatchObject({ code: 'STATS_SEASON_NOT_AVAILABLE' });
    await expect(
      new StatsHubService(
        repository({ teamExists: vi.fn().mockResolvedValue(false) }),
      ).getSeasonLeaders({
        ...base,
        metric: 'passing_yards',
        teamId,
      }),
    ).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' });
    await expect(
      new StatsHubService(repository()).getSeasonLeaders({
        ...base,
        metric: 'passing_yards',
        position: 'INVALID',
      }),
    ).rejects.toMatchObject({ code: 'STATS_POSITION_NOT_SUPPORTED' });
  });

  it('summarizes recent recorded appearances without converting missing values to zero', async () => {
    const performances = [recentRow(2025, 1, 10), recentRow(2025, 2, null), recentRow(2025, 3, 20)];
    const result = await new StatsHubService(
      repository({ findRecent: vi.fn().mockResolvedValue(performances) }),
    ).getRecentPerformance({ playerId, metric: 'receiving_yards', games: 5 });
    expect(result).toMatchObject({
      data: {
        performances,
        summary: {
          gamesRepresented: 3,
          valuesRepresented: 2,
          missingDataCount: 1,
          average: 15,
          total: 30,
          minimum: 10,
          maximum: 20,
        },
      },
    });
  });

  it('returns the stable player not-found error for recent performance', async () => {
    await expect(
      new StatsHubService(
        repository({ findPlayer: vi.fn().mockResolvedValue(null) }),
      ).getRecentPerformance({ playerId, metric: 'receiving_yards', games: 5 }),
    ).rejects.toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });
});

function rankedSeasonRow() {
  return {
    rowId: playerId,
    rank: 1,
    tied: true,
    player: {
      id: playerId,
      displayName: 'Test Player',
      position: 'QB',
      positionGroup: 'QB',
      headshotUrl: null,
    },
    metricValue: 4500,
    games: 17,
    season: 2025,
    seasonType: 'REG' as const,
    teamContext: { type: 'SINGLE' as const, teams: [] },
    qualifyingContext: null,
  };
}

function recentRow(season: number, week: number, value: number | null) {
  return {
    gameId: `00000000-0000-4000-8000-${String(week).padStart(12, '0')}`,
    season,
    seasonType: 'REG' as const,
    week,
    gameDate: null,
    team: { id: teamId, abbreviation: 'TST', fullName: 'Test Team' },
    opponent: { id: playerId, abbreviation: 'OPP', fullName: 'Opponent' },
    value,
  };
}
