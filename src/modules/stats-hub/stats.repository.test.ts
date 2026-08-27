import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { findStatsMetric } from './stats-metrics.js';
import { PrismaStatsHubRepository } from './stats.repository.js';

const playerId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const opponentId = '00000000-0000-4000-8000-000000000003';
const gameId = '00000000-0000-4000-8000-000000000004';
const statId = '00000000-0000-4000-8000-000000000005';

describe('Stats Hub repository', () => {
  it('uses a window rank and team-only aggregation for team-filtered season leaders', async () => {
    const queryRaw = vi.fn().mockResolvedValue([seasonDatabaseRow()]);
    const repository = new PrismaStatsHubRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    const result = await repository.findSeasonLeaders(requireMetric('receiving_yards'), {
      season: 2025,
      seasonType: 'REG',
      teamId,
      limit: 25,
    });
    const query = firstSql(queryRaw);
    expect(query.sql).toContain('RANK() OVER');
    expect(query.sql).toContain('SUM(stat."receiving_yards")');
    expect(query.values).toContain(teamId);
    expect(result.rows[0]).toMatchObject({
      rank: 1,
      tied: true,
      metricValue: 100,
      teamContext: { type: 'SINGLE', teams: [{ id: teamId }] },
    });
  });

  it('uses stored season summaries and derives total tackles from reviewed fields', async () => {
    const queryRaw = vi.fn().mockResolvedValue([seasonDatabaseRow()]);
    const repository = new PrismaStatsHubRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    await repository.findSeasonLeaders(requireMetric('tackles'), {
      season: 2025,
      seasonType: 'POST',
      positionGroup: 'LB',
      limit: 25,
    });
    const query = firstSql(queryRaw);
    expect(query.sql).toContain('summary."tackles_solo"');
    expect(query.sql).toContain('summary."tackle_assists"');
    expect(query.sql).toContain('player_season_stats');
    expect(query.values).toContain('POST');
    expect(query.values).toContain('LB');
  });

  it('returns distinct weekly game/team performances with public context', async () => {
    const queryRaw = vi.fn().mockResolvedValue([weeklyDatabaseRow()]);
    const repository = new PrismaStatsHubRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    const result = await repository.findWeeklyLeaders(requireMetric('passing_yards'), {
      season: 2025,
      week: 10,
      seasonType: 'REG',
      limit: 25,
    });
    const query = firstSql(queryRaw);
    expect(query.sql).toContain('stat.id AS row_id');
    expect(query.sql).toContain('metric_value IS NOT NULL');
    expect(result.rows[0]).toMatchObject({
      gameId,
      team: { id: teamId, abbreviation: 'TST' },
      opponent: { id: opponentId, abbreviation: 'OPP' },
    });
  });

  it('limits recent appearances before returning them chronologically', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValue([recentDatabaseRow(3, 30), recentDatabaseRow(2, null)]);
    const repository = new PrismaStatsHubRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    const result = await repository.findRecent(requireMetric('receiving_yards'), {
      playerId,
      games: 5,
    });
    expect(result.map(({ week }) => week)).toEqual([2, 3]);
    expect(result.map(({ value }) => value)).toEqual([null, 30]);
    expect(firstSql(queryRaw).values).toContain(5);
  });
});

function requireMetric(id: string) {
  const metric = findStatsMetric(id);
  if (metric === undefined) throw new Error('Missing metric fixture.');
  return metric;
}

function firstSql(mock: ReturnType<typeof vi.fn>): { sql: string; values: readonly unknown[] } {
  const call: unknown = mock.mock.calls[0]?.[0];
  if (
    typeof call !== 'object' ||
    call === null ||
    !('sql' in call) ||
    typeof call.sql !== 'string' ||
    !('values' in call) ||
    !Array.isArray(call.values)
  )
    throw new Error('Expected a Prisma SQL query.');
  return { sql: call.sql, values: call.values };
}

function seasonDatabaseRow() {
  return {
    row_id: playerId,
    rank: 1n,
    tied: true,
    player_id: playerId,
    display_name: 'Test Player',
    position: 'WR',
    position_group: 'WR',
    headshot_url: null,
    metric_value: 100,
    games: 10,
    season: 2025,
    season_type: 'REG',
    teams: [{ id: teamId, abbreviation: 'TST', fullName: 'Test Team' }],
  };
}

function weeklyDatabaseRow() {
  return {
    row_id: statId,
    rank: 1n,
    tied: false,
    player_id: playerId,
    display_name: 'Test Player',
    position: 'QB',
    position_group: 'QB',
    headshot_url: null,
    metric_value: 300,
    games: 1,
    season: 2025,
    season_type: 'REG',
    week: 10,
    game_id: gameId,
    game_date: null,
    team_id: teamId,
    team_abbreviation: 'TST',
    team_full_name: 'Test Team',
    opponent_id: opponentId,
    opponent_abbreviation: 'OPP',
    opponent_full_name: 'Opponent',
  };
}

function recentDatabaseRow(week: number, metricValue: number | null) {
  return {
    game_id: gameId,
    season: 2025,
    season_type: 'REG',
    week,
    game_date: null,
    team_id: teamId,
    team_abbreviation: 'TST',
    team_full_name: 'Test Team',
    opponent_id: opponentId,
    opponent_abbreviation: 'OPP',
    opponent_full_name: 'Opponent',
    metric_value: metricValue,
  };
}
