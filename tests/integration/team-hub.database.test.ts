import 'dotenv/config';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaArticleRepository } from '../../src/modules/articles/article.repository.js';
import { ArticleService } from '../../src/modules/articles/article.service.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import { PrismaStatsHubRepository } from '../../src/modules/stats-hub/stats.repository.js';
import { StatsHubService } from '../../src/modules/stats-hub/stats.service.js';
import { PrismaTeamHubRepository } from '../../src/modules/team-hub/team-hub.repository.js';
import { createTeamHubRouter } from '../../src/modules/team-hub/team-hub.routes.js';
import { TeamHubService } from '../../src/modules/team-hub/team-hub.service.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';

const enabled = process.env.RUN_TEAM_HUB_DATABASE_TESTS === 'true';

describe.skipIf(!enabled)('Team Hub database', () => {
  let prisma: PrismaClient | undefined;
  let service: TeamHubService | undefined;
  let stats: StatsHubService | undefined;
  let teamId: string | undefined;
  let nfcTeamId: string | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    const teams = new TeamService(new PrismaTeamRepository(prisma));
    stats = new StatsHubService(new PrismaStatsHubRepository(prisma));
    service = new TeamHubService({
      repository: new PrismaTeamHubRepository(prisma),
      teams,
      games: new GameService(new PrismaGameRepository(prisma, 'none'), () => new Date(), {
        currentNflSeason: 2026,
        allowHistoricalDefaultGameResults: false,
      }),
      articles: new ArticleService(new PrismaArticleRepository(prisma)),
      stats,
      currentNflSeason: 2026,
    });
    teamId = (
      await prisma.team.findFirstOrThrow({
        where: { abbreviation: 'KC', league: 'NFL', isActive: true },
        select: { id: true },
      })
    ).id;
    nfcTeamId = (
      await prisma.team.findFirstOrThrow({
        where: { abbreviation: 'SF', league: 'NFL', isActive: true },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('composes only normalized public overview fields and exact imported coverage', async () => {
    const response = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/hub`)
      .expect(200);
    const body = response.body as unknown as OverviewBody;
    expect(body.data.team).toMatchObject({ id: teamId, abbreviation: 'KC' });
    expect(body.data.schedule.upcoming.length).toBeLessThanOrEqual(3);
    expect(body.data.schedule.recent.length).toBeLessThanOrEqual(3);
    expect(
      [...body.data.schedule.upcoming, ...body.data.schedule.recent].every(
        (game: { season: number }) => game.season === 2026,
      ),
    ).toBe(true);
    expect(body.data.news.articles.length).toBeLessThanOrEqual(3);
    expect(body.data.historicalData).toMatchObject({
      defaultSeason: 2025,
      rosterSeasons: [2025, 2024, 2023, 2022, 2021, 2020],
      statSeasons: [2025, 2024, 2023, 2022, 2021, 2020],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /externalId|providerTeamId|sourceRowHash|checksum|filePath|initiatedBy|revision|actorSnapshot/,
    );
  });

  it('returns unique historical players and stable cursor continuation', async () => {
    const first = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/roster?season=2025&limit=10`)
      .expect(200);
    const firstBody = first.body as unknown as RosterBody;
    expect(firstBody.data.roster).toHaveLength(10);
    expect(new Set(firstBody.data.roster.map((row) => row.player.id)).size).toBe(10);
    expect(
      firstBody.data.roster.every(
        (row) =>
          row.season === 2025 &&
          row.historicalTeam.id === teamId &&
          row.firstWeek <= row.lastWeek &&
          row.rosterWeekCount > 0,
      ),
    ).toBe(true);
    expect(firstBody.meta.nextCursor).toEqual(expect.any(String));
    const second = await request(app(requireService(service)))
      .get(
        `/teams/${requireTeamId(teamId)}/roster?season=2025&limit=10&cursor=${encodeURIComponent(firstBody.meta.nextCursor ?? '')}`,
      )
      .expect(200);
    const secondBody = second.body as unknown as RosterBody;
    const firstIds = new Set(firstBody.data.roster.map((row) => row.player.id));
    expect(secondBody.data.roster.every((row) => !firstIds.has(row.player.id))).toBe(true);
  });

  it('supports roster filters and refuses to invent an unavailable 2026 roster', async () => {
    const filtered = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/roster?season=2025&positionGroup=WR&limit=100`)
      .expect(200);
    const filteredBody = filtered.body as unknown as RosterBody;
    expect(filteredBody.data.roster.length).toBeGreaterThan(0);
    expect(filteredBody.data.roster.every((row) => row.positionGroup === 'WR')).toBe(true);
    const unavailable = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/roster?season=2026`)
      .expect(400);
    const unavailableBody = unavailable.body as unknown as ErrorBody;
    expect(unavailableBody.error.code).toBe('TEAM_ROSTER_SEASON_NOT_AVAILABLE');
  });

  it('returns the exact existing Stats Hub team-split response', async () => {
    const expected = await requireStats(stats).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'receiving_yards',
      positionGroup: 'WR',
      teamId: requireTeamId(teamId),
      limit: 10,
    });
    const response = await request(app(requireService(service)))
      .get(
        `/teams/${requireTeamId(teamId)}/stat-leaders?season=2025&metric=receiving_yards&positionGroup=WR&limit=10`,
      )
      .expect(200);
    const body = response.body as unknown as StatsLeaderBody;
    expect(body).toEqual(expected);
    expect(
      body.data.every(
        (row) => row.teamContext.type === 'SINGLE' && row.teamContext.teams[0]?.id === teamId,
      ),
    ).toBe(true);
  });

  it('serves every leader category and preserves Stats Hub validation errors', async () => {
    for (const metric of [
      'passing_yards',
      'rushing_yards',
      'receiving_yards',
      'tackles',
      'field_goals_made',
    ]) {
      const response = await request(app(requireService(service)))
        .get(`/teams/${requireTeamId(teamId)}/stat-leaders?season=2025&metric=${metric}&limit=5`)
        .expect(200);
      const body = response.body as unknown as StatsLeaderBody;
      expect(body.data.length).toBeGreaterThan(0);
    }
    const invalidMetric = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/stat-leaders?season=2025&metric=raw_column`)
      .expect(404);
    expect((invalidMetric.body as unknown as ErrorBody).error.code).toBe('STATS_METRIC_NOT_FOUND');
    const invalidSeason = await request(app(requireService(service)))
      .get(`/teams/${requireTeamId(teamId)}/stat-leaders?season=2026&metric=passing_yards`)
      .expect(400);
    expect((invalidSeason.body as unknown as ErrorBody).error.code).toBe(
      'STATS_SEASON_NOT_AVAILABLE',
    );
    const invalidCursor = await request(app(requireService(service)))
      .get(
        `/teams/${requireTeamId(teamId)}/stat-leaders?season=2025&metric=passing_yards&cursor=invalid`,
      )
      .expect(400);
    expect((invalidCursor.body as unknown as ErrorBody).error.code).toBe('STATS_INVALID_CURSOR');
  });

  it('verifies an NFC team, defensive leaders, and the standard unknown-team error', async () => {
    const id = requireTeamId(nfcTeamId);
    const overview = await request(app(requireService(service)))
      .get(`/teams/${id}/hub`)
      .expect(200);
    expect((overview.body as unknown as OverviewBody).data.team).toMatchObject({
      id,
      abbreviation: 'SF',
    });
    const roster = await request(app(requireService(service)))
      .get(`/teams/${id}/roster?season=2025&limit=5`)
      .expect(200);
    expect((roster.body as unknown as RosterBody).data.roster).toHaveLength(5);
    const leaders = await request(app(requireService(service)))
      .get(`/teams/${id}/stat-leaders?season=2025&metric=tackles&limit=10`)
      .expect(200);
    expect((leaders.body as unknown as StatsLeaderBody).data.length).toBeGreaterThan(0);

    const missingId = '00000000-0000-4000-8000-000000000099';
    const missing = await request(app(requireService(service)))
      .get(`/teams/${missingId}/hub`)
      .expect(404);
    expect((missing.body as unknown as ErrorBody).error.code).toBe('TEAM_NOT_FOUND');
  });

  it('shows a historically traded player on each recorded team without relabeling history', async () => {
    const rows = await requirePrisma(prisma).$queryRaw<
      readonly {
        player_id: string;
        display_name: string;
        season: number;
        team_ids: string[];
      }[]
    >(Prisma.sql`
      SELECT r.player_id,
             p.display_name,
             r.season,
             ARRAY_AGG(DISTINCT r.team_id) FILTER (WHERE r.team_id IS NOT NULL) AS team_ids
      FROM player_week_rosters r
      JOIN players p ON p.id = r.player_id
      WHERE r.team_id IS NOT NULL
      GROUP BY r.player_id, p.display_name, r.season
      HAVING COUNT(DISTINCT r.team_id) > 1
      ORDER BY r.season DESC, p.display_name ASC
      LIMIT 1
    `);
    const traded = rows[0];
    if (traded === undefined) throw new Error('Expected a historical multi-team roster record.');
    for (const recordedTeamId of traded.team_ids) {
      const roster = await requireService(service).getRoster(recordedTeamId, {
        season: traded.season,
        search: traded.display_name,
        limit: 100,
      });
      const match = roster.data.roster.find(({ player }) => player.id === traded.player_id);
      expect(match?.historicalTeam.id).toBe(recordedTeamId);
    }
  });
});

function app(service: TeamHubService) {
  const instance = express();
  instance.use('/teams/:teamId', createTeamHubRouter(service));
  instance.use(errorHandler);
  return instance;
}

function requireService(service: TeamHubService | undefined): TeamHubService {
  if (service === undefined) throw new Error('Team Hub service was not initialized.');
  return service;
}

function requireStats(stats: StatsHubService | undefined): StatsHubService {
  if (stats === undefined) throw new Error('Stats Hub service was not initialized.');
  return stats;
}

function requireTeamId(id: string | undefined): string {
  if (id === undefined) throw new Error('Team fixture was not initialized.');
  return id;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) throw new Error('Team Hub database client was not initialized.');
  return prisma;
}

interface OverviewBody {
  readonly data: {
    readonly team: { readonly id: string; readonly abbreviation: string };
    readonly schedule: {
      readonly upcoming: readonly { readonly season: number }[];
      readonly recent: readonly { readonly season: number }[];
    };
    readonly news: { readonly articles: readonly unknown[] };
    readonly historicalData: {
      readonly defaultSeason: number | null;
      readonly rosterSeasons: readonly number[];
      readonly statSeasons: readonly number[];
    };
  };
}

interface RosterBody {
  readonly data: {
    readonly roster: readonly {
      readonly player: { readonly id: string };
      readonly season: number;
      readonly historicalTeam: { readonly id: string };
      readonly positionGroup: string | null;
      readonly firstWeek: number;
      readonly lastWeek: number;
      readonly rosterWeekCount: number;
    }[];
  };
  readonly meta: { readonly nextCursor: string | null };
}

interface StatsLeaderBody {
  readonly data: readonly {
    readonly teamContext: {
      readonly type: string;
      readonly teams: readonly { readonly id: string }[];
    };
  }[];
  readonly meta: unknown;
}

interface ErrorBody {
  readonly error: { readonly code: string };
}
