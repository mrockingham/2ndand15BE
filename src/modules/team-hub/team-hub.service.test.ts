import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import type { PublicArticleReader } from '../articles/article.service.js';
import type { GameDto } from '../games/game.dto.js';
import type { GameReader } from '../games/game.service.js';
import type { StatsHubReader } from '../stats-hub/stats.service.js';
import type { TeamDto } from '../teams/team.dto.js';
import type { TeamReader } from '../teams/team.service.js';
import type { TeamHubRepository } from './team-hub.repository.js';
import { TeamHubService } from './team-hub.service.js';

const teamId = '00000000-0000-4000-8000-000000000001';
const playerOne = '00000000-0000-4000-8000-000000000002';
const playerTwo = '00000000-0000-4000-8000-000000000003';

describe('Team Hub service', () => {
  it('composes a compact overview from existing public readers and factual coverage', async () => {
    const service = createService({
      games: gameReader([
        game('00000000-0000-4000-8000-000000000011', 'SCHEDULED', null),
        game('00000000-0000-4000-8000-000000000012', 'FINAL', '2026-08-01T00:00:00.000Z'),
        game('00000000-0000-4000-8000-000000000013', 'SCHEDULED', '2026-09-01T00:00:00.000Z'),
        game('00000000-0000-4000-8000-000000000014', 'FINAL', '2026-08-03T00:00:00.000Z'),
      ]),
    });
    const result = await service.getOverview(teamId);
    expect(result.data.schedule.upcoming.map(({ id }) => id)).toEqual([
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000011',
    ]);
    expect(result.data.schedule.recent.map(({ id }) => id)).toEqual([
      '00000000-0000-4000-8000-000000000014',
      '00000000-0000-4000-8000-000000000012',
    ]);
    expect(result.data.historicalData).toMatchObject({
      defaultSeason: 2025,
      positionGroups: ['DB', 'SPEC', 'WR'],
    });
    expect(result.meta.attribution.source).toBe('nflverse');
  });

  it('prioritizes the canonical team error while overview dependencies run concurrently', async () => {
    const canonical = new AppError({
      code: 'TEAM_NOT_FOUND',
      message: 'The requested active team was not found.',
      statusCode: 404,
    });
    const service = createService({
      teams: {
        listActiveTeams: vi.fn().mockResolvedValue([]),
        getActiveTeam: vi.fn().mockRejectedValue(canonical),
      },
    });
    await expect(service.getOverview(teamId)).rejects.toBe(canonical);
  });

  it('returns one row per player with explicit historical and latest-team semantics', async () => {
    const service = createService();
    const first = await service.getRoster(teamId, { season: 2025, limit: 1 });
    expect(first.data.roster).toHaveLength(1);
    expect(first.data.roster[0]).toMatchObject({
      player: { id: playerTwo, displayName: 'Alpha Kicker' },
      season: 2025,
      historicalTeam: { id: teamId },
      latestKnownTeam: { abbreviation: 'OTH' },
      position: 'K',
      positionGroup: 'SPEC',
      firstWeek: 1,
      lastWeek: 3,
      rosterWeekCount: 3,
    });
    expect(first.meta.semantics.membership).toContain('at least one stored weekly roster');
    expect(first.meta.nextCursor).not.toBeNull();
    const second = await service.getRoster(teamId, {
      season: 2025,
      limit: 1,
      cursor: first.meta.nextCursor ?? undefined,
    });
    expect(second.data.roster[0]?.player.id).toBe(playerOne);
  });

  it('filters by normalized search and rejects unavailable seasons or unsupported positions', async () => {
    const service = createService();
    const filtered = await service.getRoster(teamId, {
      season: 2025,
      positionGroup: 'WR',
      search: 'beta receiver',
      limit: 25,
    });
    expect(filtered.data.roster.map(({ player }) => player.id)).toEqual([playerOne]);
    await expect(
      service.getRoster(teamId, { season: 2025, position: 'INVALID', limit: 25 }),
    ).rejects.toMatchObject({ code: 'TEAM_ROSTER_POSITION_NOT_SUPPORTED' });
    await expect(
      createService({
        repository: repository({ rosterSeasonExists: vi.fn().mockResolvedValue(false) }),
      }).getRoster(teamId, { season: 2026, limit: 25 }),
    ).rejects.toMatchObject({ code: 'TEAM_ROSTER_SEASON_NOT_AVAILABLE' });
  });

  it('injects the path team into the existing season-leader query unchanged', async () => {
    const getSeasonLeaders = vi.fn().mockResolvedValue({ data: [], meta: {} });
    const service = createService({ stats: { getSeasonLeaders } });
    await service.getStatLeaders(teamId, {
      season: 2025,
      seasonType: 'REG_POST',
      metric: 'tackles',
      positionGroup: 'LB',
      limit: 10,
    });
    expect(getSeasonLeaders).toHaveBeenCalledWith({
      season: 2025,
      seasonType: 'REG_POST',
      metric: 'tackles',
      positionGroup: 'LB',
      limit: 10,
      teamId,
    });
  });
});

function createService(
  overrides: {
    repository?: TeamHubRepository;
    games?: GameReader;
    stats?: Pick<StatsHubReader, 'getSeasonLeaders'>;
    teams?: TeamReader;
  } = {},
): TeamHubService {
  return new TeamHubService({
    repository: overrides.repository ?? repository(),
    teams: overrides.teams ?? teamReader(),
    games: overrides.games ?? gameReader([]),
    articles: articleReader(),
    stats:
      overrides.stats ??
      ({ getSeasonLeaders: vi.fn().mockResolvedValue({ data: [], meta: {} }) } as const),
    currentNflSeason: 2026,
  });
}

function repository(overrides: Partial<TeamHubRepository> = {}): TeamHubRepository {
  return {
    findCoverage: vi.fn().mockResolvedValue({
      rosterSeasons: [2025, 2024],
      statSeasons: [2025, 2024],
      positions: ['DB', 'K', 'WR'],
    }),
    rosterSeasonExists: vi.fn().mockResolvedValue(true),
    findRosterCandidates: vi.fn().mockResolvedValue([
      candidate(playerOne, 'Beta Receiver', 'beta receiver', 'WR', null),
      candidate(playerTwo, 'Alpha Kicker', 'alpha kicker', 'K', {
        id: '00000000-0000-4000-8000-000000000099',
        abbreviation: 'OTH',
        fullName: 'Other Team',
      }),
    ]),
    ...overrides,
  };
}

function teamReader(): TeamReader {
  return {
    listActiveTeams: vi.fn().mockResolvedValue([team]),
    getActiveTeam: vi.fn().mockResolvedValue(team),
  };
}

function articleReader(): PublicArticleReader {
  return {
    list: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    listFeatured: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    listForTeam: vi.fn().mockResolvedValue({ articles: [], nextCursor: null }),
    getBySlug: vi.fn(),
  };
}

function gameReader(games: readonly GameDto[]): GameReader {
  return {
    listGames: vi.fn().mockResolvedValue({ games, nextCursor: null }),
    listTeamGames: vi.fn().mockResolvedValue({ games, nextCursor: null }),
    getGame: vi.fn(),
  };
}

function candidate(
  playerIdValue: string,
  displayName: string,
  normalizedName: string,
  position: string,
  latestKnownTeam: { id: string; abbreviation: string; fullName: string } | null,
) {
  return {
    playerId: playerIdValue,
    displayName,
    normalizedName,
    headshotUrl: null,
    position,
    jerseyNumber: 10,
    status: 'ACT',
    firstWeek: 1,
    lastWeek: 3,
    rosterWeekCount: 3,
    latestKnownTeam,
  };
}

function game(id: string, status: GameDto['status'], startTime: string | null): GameDto {
  const summary = {
    id: teamId,
    fullName: 'Test Team',
    abbreviation: 'TST',
    logoUrl: null,
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
  };
  return {
    id,
    league: 'NFL',
    season: 2026,
    seasonType: 'REG',
    week: 1,
    startTime,
    status,
    homeTeam: summary,
    awayTeam: { ...summary, id: playerOne, abbreviation: 'OPP' },
    homeScore: status === 'FINAL' ? 20 : null,
    awayScore: status === 'FINAL' ? 17 : null,
    quarter: null,
    clock: null,
    venue: { name: null, city: null },
    broadcastNetwork: null,
    isNeutralSite: false,
  };
}

const team: TeamDto = {
  id: teamId,
  league: 'NFL',
  city: 'Test',
  name: 'Team',
  fullName: 'Test Team',
  abbreviation: 'TST',
  conference: 'AFC',
  division: 'East',
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  logoUrl: null,
  logoSource: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
