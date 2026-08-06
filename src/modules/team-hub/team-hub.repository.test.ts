import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaTeamHubRepository } from './team-hub.repository.js';

const teamId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';

describe('Team Hub repository', () => {
  it('reads distinct roster and stat coverage without provider identifiers', async () => {
    const rosterFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ season: 2025 }, { season: 2024 }])
      .mockResolvedValueOnce([{ position: 'K' }, { position: 'WR' }]);
    const repository = new PrismaTeamHubRepository({
      playerWeekRoster: { findMany: rosterFindMany },
      playerGameStat: { findMany: vi.fn().mockResolvedValue([{ season: 2025 }]) },
    } as unknown as PrismaClient);
    await expect(repository.findCoverage(teamId)).resolves.toEqual({
      rosterSeasons: [2025, 2024],
      statSeasons: [2025],
      positions: ['K', 'WR'],
    });
    expect(rosterFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { teamId }, distinct: ['season'] }),
    );
  });

  it('aggregates weekly roster records into one bounded player row', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        player_id: playerId,
        display_name: 'Test Player',
        normalized_name: 'test player',
        headshot_url: null,
        position: 'WR',
        jersey_number: 11,
        status: 'ACT',
        first_week: 1,
        last_week: 18,
        roster_week_count: 18,
        latest_team_id: teamId,
        latest_team_abbreviation: 'TST',
        latest_team_full_name: 'Test Team',
      },
    ]);
    const result = await new PrismaTeamHubRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient).findRosterCandidates(teamId, 2025);
    const query = firstSql(queryRaw);
    expect(query.sql).toContain('COUNT(DISTINCT r.week)');
    expect(query.sql).toContain('LIMIT');
    expect(query.values).toContain(teamId);
    expect(query.values).toContain(2025);
    expect(result).toEqual([
      expect.objectContaining({
        playerId,
        firstWeek: 1,
        lastWeek: 18,
        rosterWeekCount: 18,
        latestKnownTeam: { id: teamId, abbreviation: 'TST', fullName: 'Test Team' },
      }),
    ]);
  });
});

function firstSql(mock: ReturnType<typeof vi.fn>): { sql: string; values: readonly unknown[] } {
  const call: unknown = mock.mock.calls[0]?.[0];
  if (
    typeof call !== 'object' ||
    call === null ||
    !('sql' in call) ||
    typeof call.sql !== 'string' ||
    !('values' in call) ||
    !Array.isArray(call.values)
  ) {
    throw new Error('Expected a Prisma SQL query.');
  }
  return { sql: call.sql, values: call.values };
}
