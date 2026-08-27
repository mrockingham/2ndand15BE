import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import type { TeamRosterCandidate } from './team-hub.dto.js';

const MAX_ROSTER_CANDIDATES = 500;

export interface TeamHubCoverage {
  readonly rosterSeasons: readonly number[];
  readonly statSeasons: readonly number[];
  readonly positions: readonly string[];
}

export interface TeamHubRepository {
  findCoverage(teamId: string): Promise<TeamHubCoverage>;
  rosterSeasonExists(teamId: string, season: number): Promise<boolean>;
  findRosterCandidates(teamId: string, season: number): Promise<readonly TeamRosterCandidate[]>;
}

interface RosterDatabaseRow {
  readonly player_id: string;
  readonly display_name: string;
  readonly normalized_name: string;
  readonly headshot_url: string | null;
  readonly position: string | null;
  readonly jersey_number: number | null;
  readonly status: string | null;
  readonly first_week: number;
  readonly last_week: number;
  readonly roster_week_count: number;
  readonly latest_team_id: string | null;
  readonly latest_team_abbreviation: string | null;
  readonly latest_team_full_name: string | null;
}

export class PrismaTeamHubRepository implements TeamHubRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCoverage(teamId: string): Promise<TeamHubCoverage> {
    const [rosterSeasons, statSeasons, positions] = await Promise.all([
      this.prisma.playerWeekRoster.findMany({
        where: { teamId },
        distinct: ['season'],
        select: { season: true },
        orderBy: { season: 'desc' },
      }),
      this.prisma.playerGameStat.findMany({
        where: { teamId },
        distinct: ['season'],
        select: { season: true },
        orderBy: { season: 'desc' },
      }),
      this.prisma.playerWeekRoster.findMany({
        where: { teamId, position: { not: null } },
        distinct: ['position'],
        select: { position: true },
        orderBy: { position: 'asc' },
      }),
    ]);
    return {
      rosterSeasons: rosterSeasons.map(({ season }) => season),
      statSeasons: statSeasons.map(({ season }) => season),
      positions: positions.flatMap(({ position }) => (position === null ? [] : [position])),
    };
  }

  async rosterSeasonExists(teamId: string, season: number): Promise<boolean> {
    return (await this.prisma.playerWeekRoster.count({ where: { teamId, season } })) > 0;
  }

  async findRosterCandidates(
    teamId: string,
    season: number,
  ): Promise<readonly TeamRosterCandidate[]> {
    const rows = await this.prisma.$queryRaw<readonly RosterDatabaseRow[]>(
      buildRosterCandidatesSql(teamId, season),
    );
    if (rows.length > MAX_ROSTER_CANDIDATES) {
      throw new AppError({
        code: 'TEAM_ROSTER_QUERY_TOO_BROAD',
        message: 'The team-season roster exceeded the bounded candidate limit.',
        statusCode: 400,
      });
    }
    return rows.map(toRosterCandidate);
  }
}

export function buildRosterCandidatesSql(teamId: string, season: number): Prisma.Sql {
  return Prisma.sql`
    SELECT
      p.id AS player_id,
      p.display_name,
      p.normalized_name,
      p.headshot_url,
      (ARRAY_AGG(r.position ORDER BY r.week DESC, r.id DESC)
        FILTER (WHERE r.position IS NOT NULL))[1] AS position,
      (ARRAY_AGG(r.jersey_number ORDER BY r.week DESC, r.id DESC)
        FILTER (WHERE r.jersey_number IS NOT NULL))[1] AS jersey_number,
      (ARRAY_AGG(r.status ORDER BY r.week DESC, r.id DESC)
        FILTER (WHERE r.status IS NOT NULL))[1] AS status,
      MIN(r.week)::int AS first_week,
      MAX(r.week)::int AS last_week,
      COUNT(DISTINCT r.week)::int AS roster_week_count,
      latest_team.id AS latest_team_id,
      latest_team.abbreviation AS latest_team_abbreviation,
      latest_team.full_name AS latest_team_full_name
    FROM player_week_rosters r
    JOIN players p ON p.id = r.player_id
    LEFT JOIN teams latest_team ON latest_team.id = p.latest_team_id
    WHERE r.team_id = ${teamId}::uuid AND r.season = ${season}
    GROUP BY p.id, latest_team.id
    ORDER BY p.normalized_name ASC, p.id ASC
    LIMIT ${MAX_ROSTER_CANDIDATES + 1}
  `;
}

function toRosterCandidate(row: RosterDatabaseRow): TeamRosterCandidate {
  const hasLatestTeam =
    row.latest_team_id !== null &&
    row.latest_team_abbreviation !== null &&
    row.latest_team_full_name !== null;
  return {
    playerId: row.player_id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    headshotUrl: row.headshot_url,
    position: row.position,
    jerseyNumber: row.jersey_number,
    status: row.status,
    firstWeek: row.first_week,
    lastWeek: row.last_week,
    rosterWeekCount: row.roster_week_count,
    latestKnownTeam: hasLatestTeam
      ? {
          id: row.latest_team_id,
          abbreviation: row.latest_team_abbreviation,
          fullName: row.latest_team_full_name,
        }
      : null,
  };
}
