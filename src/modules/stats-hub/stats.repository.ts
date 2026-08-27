import { z } from 'zod';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { StatsCursor } from './stats-cursor.js';
import type {
  RecentPerformanceRow,
  SeasonLeaderRow,
  StatsPlayerSummary,
  StatsTeamSummary,
  WeeklyLeaderRow,
} from './stats.dto.js';
import type { StatsMetricDefinition, StatsMetricSource } from './stats-metrics.js';

export interface SeasonLeaderFilters {
  readonly season: number;
  readonly seasonType: 'REG' | 'POST' | 'REG_POST';
  readonly position?: string | undefined;
  readonly positionGroup?: string | undefined;
  readonly teamId?: string | undefined;
  readonly limit: number;
  readonly cursor?: StatsCursor | undefined;
}

export interface WeeklyLeaderFilters {
  readonly season: number;
  readonly week: number;
  readonly seasonType: 'REG' | 'POST';
  readonly position?: string | undefined;
  readonly positionGroup?: string | undefined;
  readonly teamId?: string | undefined;
  readonly limit: number;
  readonly cursor?: StatsCursor | undefined;
}

export interface RecentFilters {
  readonly playerId: string;
  readonly season?: number | undefined;
  readonly seasonType?: 'REG' | 'POST' | undefined;
  readonly games: number;
}

export interface RankedPage<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
}

export interface StatsMetadataRecord {
  readonly seasons: readonly number[];
  readonly positions: readonly string[];
  readonly positionGroups: readonly string[];
}

export interface StatsHubRepository {
  findMetadata(): Promise<StatsMetadataRecord>;
  seasonExists(season: number): Promise<boolean>;
  teamExists(id: string): Promise<boolean>;
  findPlayer(id: string): Promise<StatsPlayerSummary | null>;
  findSeasonLeaders(
    metric: StatsMetricDefinition,
    filters: SeasonLeaderFilters,
  ): Promise<RankedPage<SeasonLeaderRow>>;
  findWeeklyLeaders(
    metric: StatsMetricDefinition,
    filters: WeeklyLeaderFilters,
  ): Promise<RankedPage<WeeklyLeaderRow>>;
  findRecent(
    metric: StatsMetricDefinition,
    filters: RecentFilters,
  ): Promise<readonly RecentPerformanceRow[]>;
}

interface RankedDatabaseRow {
  readonly row_id: string;
  readonly rank: bigint;
  readonly tied: boolean;
  readonly player_id: string;
  readonly display_name: string;
  readonly position: string | null;
  readonly position_group: string | null;
  readonly headshot_url: string | null;
  readonly metric_value: number;
  readonly games: number;
}

interface SeasonDatabaseRow extends RankedDatabaseRow {
  readonly season: number;
  readonly season_type: 'REG' | 'POST' | 'REG_POST';
  readonly teams: unknown;
}

interface WeeklyDatabaseRow extends RankedDatabaseRow {
  readonly season: number;
  readonly season_type: 'REG' | 'POST';
  readonly week: number;
  readonly game_id: string;
  readonly game_date: Date | null;
  readonly team_id: string;
  readonly team_abbreviation: string;
  readonly team_full_name: string;
  readonly opponent_id: string;
  readonly opponent_abbreviation: string;
  readonly opponent_full_name: string;
}

interface RecentDatabaseRow {
  readonly game_id: string;
  readonly season: number;
  readonly season_type: 'REG' | 'POST';
  readonly week: number;
  readonly game_date: Date | null;
  readonly team_id: string;
  readonly team_abbreviation: string;
  readonly team_full_name: string;
  readonly opponent_id: string;
  readonly opponent_abbreviation: string;
  readonly opponent_full_name: string;
  readonly metric_value: number | null;
}

const teamArraySchema = z.array(
  z.object({ id: z.uuid(), abbreviation: z.string(), fullName: z.string() }),
);

const SOURCE_COLUMN: Readonly<Record<Exclude<StatsMetricSource, 'totalTackles'>, string>> = {
  passingYards: 'passing_yards',
  passingTouchdowns: 'passing_touchdowns',
  completions: 'completions',
  attempts: 'attempts',
  passingInterceptions: 'passing_interceptions',
  rushingYards: 'rushing_yards',
  rushingTouchdowns: 'rushing_touchdowns',
  carries: 'carries',
  receivingYards: 'receiving_yards',
  receivingTouchdowns: 'receiving_touchdowns',
  receptions: 'receptions',
  targets: 'targets',
  tacklesSolo: 'tackles_solo',
  tackleAssists: 'tackle_assists',
  defensiveSacks: 'defensive_sacks',
  defensiveInterceptions: 'defensive_interceptions',
  forcedFumbles: 'forced_fumbles',
  fieldGoalsMade: 'field_goals_made',
  fieldGoalsAttempted: 'field_goals_attempted',
  extraPointsMade: 'extra_points_made',
};

export class PrismaStatsHubRepository implements StatsHubRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMetadata(): Promise<StatsMetadataRecord> {
    const [seasonRows, positionRows] = await Promise.all([
      this.prisma.$queryRaw<readonly { season: number }[]>(Prisma.sql`
        SELECT DISTINCT season FROM player_season_stats ORDER BY season ASC
      `),
      this.prisma.$queryRaw<readonly { position: string | null; position_group: string | null }[]>(
        Prisma.sql`
          SELECT DISTINCT position, position_group
          FROM player_season_stats
          WHERE position IS NOT NULL OR position_group IS NOT NULL
        `,
      ),
    ]);
    return {
      seasons: seasonRows.map(({ season }) => season),
      positions: uniqueSorted(positionRows.map(({ position }) => position)),
      positionGroups: uniqueSorted(positionRows.map(({ position_group }) => position_group)),
    };
  }

  async teamExists(id: string): Promise<boolean> {
    return (await this.prisma.team.count({ where: { id, isActive: true, league: 'NFL' } })) === 1;
  }

  async seasonExists(season: number): Promise<boolean> {
    return (await this.prisma.playerSeasonStat.count({ where: { season } })) > 0;
  }

  async findPlayer(id: string): Promise<StatsPlayerSummary | null> {
    const player = await this.prisma.player.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        position: true,
        positionGroup: true,
        headshotUrl: true,
      },
    });
    return player;
  }

  async findSeasonLeaders(
    metric: StatsMetricDefinition,
    filters: SeasonLeaderFilters,
  ): Promise<RankedPage<SeasonLeaderRow>> {
    const rows = await this.prisma.$queryRaw<readonly SeasonDatabaseRow[]>(
      buildSeasonLeadersSql(metric, filters),
    );
    const hasMore = rows.length > filters.limit;
    return {
      rows: rows.slice(0, filters.limit).map(toSeasonRow),
      hasMore,
    };
  }

  async findWeeklyLeaders(
    metric: StatsMetricDefinition,
    filters: WeeklyLeaderFilters,
  ): Promise<RankedPage<WeeklyLeaderRow>> {
    const rows = await this.prisma.$queryRaw<readonly WeeklyDatabaseRow[]>(
      buildWeeklyLeadersSql(metric, filters),
    );
    const hasMore = rows.length > filters.limit;
    return {
      rows: rows.slice(0, filters.limit).map(toWeeklyRow),
      hasMore,
    };
  }

  async findRecent(
    metric: StatsMetricDefinition,
    filters: RecentFilters,
  ): Promise<readonly RecentPerformanceRow[]> {
    const rows = await this.prisma.$queryRaw<readonly RecentDatabaseRow[]>(
      buildRecentPerformanceSql(metric, filters),
    );
    return [...rows].reverse().map(toRecentRow);
  }
}

export function buildSeasonLeadersSql(
  metric: StatsMetricDefinition,
  filters: SeasonLeaderFilters,
): Prisma.Sql {
  const candidateQuery =
    filters.teamId === undefined
      ? seasonSummaryCandidates(metric, filters)
      : teamSeasonCandidates(metric, filters, filters.teamId);
  const cursor = rankedCursorCondition(filters.cursor);
  return Prisma.sql`
    WITH candidates AS (${candidateQuery}), ranked AS (
      SELECT candidates.*,
        RANK() OVER (ORDER BY metric_value DESC) AS rank,
        COUNT(*) OVER (PARTITION BY metric_value) > 1 AS tied
      FROM candidates
      WHERE metric_value IS NOT NULL
    )
    SELECT * FROM ranked
    ${cursor}
    ORDER BY metric_value DESC, games DESC, display_name ASC, player_id ASC, row_id ASC
    LIMIT ${filters.limit + 1}
  `;
}

export function buildWeeklyLeadersSql(
  metric: StatsMetricDefinition,
  filters: WeeklyLeaderFilters,
): Prisma.Sql {
  const conditions = [
    Prisma.sql`stat.season = ${filters.season}`,
    Prisma.sql`stat.week = ${filters.week}`,
    Prisma.sql`stat.season_type::text = ${filters.seasonType}`,
    optionalEquals('stat.position', filters.position),
    optionalEquals('stat.position_group', filters.positionGroup),
    optionalUuidEquals('stat.team_id', filters.teamId),
  ].filter(isSql);
  const expression = directMetricExpression(metric.source, 'stat');
  const cursor = rankedCursorCondition(filters.cursor);
  return Prisma.sql`
    WITH candidates AS (
      SELECT stat.id AS row_id, stat.player_id, player.display_name,
        stat.position, stat.position_group, player.headshot_url,
        ${expression} AS metric_value, 1 AS games,
        stat.season, stat.season_type::text AS season_type, stat.week,
        stat.game_id, game.start_time AS game_date,
        team.id AS team_id, team.abbreviation AS team_abbreviation,
        team.full_name AS team_full_name,
        opponent.id AS opponent_id, opponent.abbreviation AS opponent_abbreviation,
        opponent.full_name AS opponent_full_name
      FROM player_game_stats stat
      JOIN players player ON player.id = stat.player_id
      JOIN games game ON game.id = stat.game_id
      JOIN teams team ON team.id = stat.team_id
      JOIN teams opponent ON opponent.id = stat.opponent_team_id
      WHERE ${Prisma.join(conditions, ' AND ')}
    ), ranked AS (
      SELECT candidates.*,
        RANK() OVER (ORDER BY metric_value DESC) AS rank,
        COUNT(*) OVER (PARTITION BY metric_value) > 1 AS tied
      FROM candidates
      WHERE metric_value IS NOT NULL
    )
    SELECT * FROM ranked
    ${cursor}
    ORDER BY metric_value DESC, games DESC, display_name ASC, player_id ASC, row_id ASC
    LIMIT ${filters.limit + 1}
  `;
}

export function buildRecentPerformanceSql(
  metric: StatsMetricDefinition,
  filters: RecentFilters,
): Prisma.Sql {
  const conditions = [
    Prisma.sql`stat.player_id = ${filters.playerId}::uuid`,
    optionalNumberEquals('stat.season', filters.season),
    optionalEquals('stat.season_type', filters.seasonType),
    Prisma.sql`(
      stat.season < EXTRACT(YEAR FROM NOW())::integer
      OR (
        stat.season = EXTRACT(YEAR FROM NOW())::integer
        AND game.start_time IS NOT NULL
        AND game.start_time <= NOW()
      )
    )`,
  ].filter(isSql);
  const expression = directMetricExpression(metric.source, 'stat');
  return Prisma.sql`
    SELECT stat.game_id, stat.season, stat.season_type::text AS season_type, stat.week,
      game.start_time AS game_date,
      team.id AS team_id, team.abbreviation AS team_abbreviation,
      team.full_name AS team_full_name,
      opponent.id AS opponent_id, opponent.abbreviation AS opponent_abbreviation,
      opponent.full_name AS opponent_full_name,
      ${expression} AS metric_value
    FROM player_game_stats stat
    JOIN games game ON game.id = stat.game_id
    JOIN teams team ON team.id = stat.team_id
    JOIN teams opponent ON opponent.id = stat.opponent_team_id
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY stat.season DESC,
      CASE WHEN stat.season_type = 'POST' THEN 2 ELSE 1 END DESC,
      stat.week DESC, stat.game_id DESC, stat.team_id DESC
    LIMIT ${filters.games}
  `;
}

function seasonSummaryCandidates(
  metric: StatsMetricDefinition,
  filters: SeasonLeaderFilters,
): Prisma.Sql {
  const conditions = [
    Prisma.sql`summary.season = ${filters.season}`,
    Prisma.sql`summary.summary_type::text = ${filters.seasonType}`,
    optionalEquals('summary.position', filters.position),
    optionalEquals('summary.position_group', filters.positionGroup),
  ].filter(isSql);
  const expression = directMetricExpression(metric.source, 'summary');
  const gameType =
    filters.seasonType === 'REG_POST'
      ? Prisma.sql`stat.season_type IN ('REG', 'POST')`
      : Prisma.sql`stat.season_type::text = ${filters.seasonType}`;
  return Prisma.sql`
    SELECT summary.player_id AS row_id, summary.player_id, player.display_name,
      summary.position, summary.position_group, player.headshot_url,
      ${expression} AS metric_value, summary.games,
      summary.season, summary.summary_type::text AS season_type,
      COALESCE(team_context.teams, '[]'::jsonb) AS teams
    FROM player_season_stats summary
    JOIN players player ON player.id = summary.player_id
    LEFT JOIN (
      SELECT distinct_team.player_id, jsonb_agg(
          jsonb_build_object('id', distinct_team.id, 'abbreviation', distinct_team.abbreviation,
            'fullName', distinct_team.full_name)
          ORDER BY distinct_team.abbreviation
        ) AS teams
      FROM (
        SELECT DISTINCT stat.player_id, team.id, team.abbreviation, team.full_name
        FROM player_game_stats stat
        JOIN teams team ON team.id = stat.team_id
        WHERE stat.season = ${filters.season} AND ${gameType}
      ) distinct_team
      GROUP BY distinct_team.player_id
    ) team_context ON team_context.player_id = summary.player_id
    WHERE ${Prisma.join(conditions, ' AND ')}
  `;
}

function teamSeasonCandidates(
  metric: StatsMetricDefinition,
  filters: SeasonLeaderFilters,
  teamId: string,
): Prisma.Sql {
  const conditions = [
    Prisma.sql`stat.season = ${filters.season}`,
    seasonGameTypeCondition(filters.seasonType),
    Prisma.sql`stat.team_id = ${teamId}::uuid`,
    optionalEquals('stat.position', filters.position),
    optionalEquals('stat.position_group', filters.positionGroup),
  ].filter(isSql);
  const expression = aggregateMetricExpression(metric.source, 'stat');
  return Prisma.sql`
    SELECT player.id AS row_id, player.id AS player_id, player.display_name,
      (ARRAY_AGG(stat.position ORDER BY stat.week DESC, stat.id DESC)
        FILTER (WHERE stat.position IS NOT NULL))[1] AS position,
      (ARRAY_AGG(stat.position_group ORDER BY stat.week DESC, stat.id DESC)
        FILTER (WHERE stat.position_group IS NOT NULL))[1] AS position_group,
      player.headshot_url, ${expression} AS metric_value,
      COUNT(DISTINCT stat.game_id)::integer AS games,
      stat.season, ${filters.seasonType}::text AS season_type,
      jsonb_build_array(jsonb_build_object('id', team.id, 'abbreviation', team.abbreviation,
        'fullName', team.full_name)) AS teams
    FROM player_game_stats stat
    JOIN players player ON player.id = stat.player_id
    JOIN teams team ON team.id = stat.team_id
    WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY player.id, player.display_name, player.headshot_url, stat.season,
      team.id, team.abbreviation, team.full_name
  `;
}

function seasonGameTypeCondition(type: SeasonLeaderFilters['seasonType']): Prisma.Sql {
  return type === 'REG_POST'
    ? Prisma.sql`stat.season_type IN ('REG', 'POST')`
    : Prisma.sql`stat.season_type::text = ${type}`;
}

function directMetricExpression(source: StatsMetricSource, alias: string): Prisma.Sql {
  if (source === 'totalTackles')
    return Prisma.raw(
      `(${trustedColumn(alias, 'tackles_solo')} + ${trustedColumn(alias, 'tackle_assists')})::double precision`,
    );
  return Prisma.raw(`${trustedColumn(alias, SOURCE_COLUMN[source])}::double precision`);
}

function aggregateMetricExpression(source: StatsMetricSource, alias: string): Prisma.Sql {
  if (source === 'totalTackles')
    return Prisma.raw(
      `(SUM(${trustedColumn(alias, 'tackles_solo')}) + SUM(${trustedColumn(alias, 'tackle_assists')}))::double precision`,
    );
  return Prisma.raw(`SUM(${trustedColumn(alias, SOURCE_COLUMN[source])})::double precision`);
}

function trustedColumn(alias: string, column: string): string {
  return `${alias}."${column}"`;
}

function optionalEquals(column: string, value: string | undefined): Prisma.Sql | undefined {
  return value === undefined ? undefined : Prisma.sql`${Prisma.raw(column)}::text = ${value}`;
}

function optionalUuidEquals(column: string, value: string | undefined): Prisma.Sql | undefined {
  return value === undefined ? undefined : Prisma.sql`${Prisma.raw(column)} = ${value}::uuid`;
}

function optionalNumberEquals(column: string, value: number | undefined): Prisma.Sql | undefined {
  return value === undefined ? undefined : Prisma.sql`${Prisma.raw(column)} = ${value}`;
}

function isSql(value: Prisma.Sql | undefined): value is Prisma.Sql {
  return value !== undefined;
}

function rankedCursorCondition(cursor: StatsCursor | undefined): Prisma.Sql {
  if (cursor === undefined) return Prisma.empty;
  return Prisma.sql`WHERE (
    ranked.metric_value < ${cursor.value}
    OR (ranked.metric_value = ${cursor.value} AND ranked.games < ${cursor.games})
    OR (ranked.metric_value = ${cursor.value} AND ranked.games = ${cursor.games}
      AND ranked.display_name > ${cursor.displayName})
    OR (ranked.metric_value = ${cursor.value} AND ranked.games = ${cursor.games}
      AND ranked.display_name = ${cursor.displayName} AND ranked.player_id > ${cursor.playerId}::uuid)
    OR (ranked.metric_value = ${cursor.value} AND ranked.games = ${cursor.games}
      AND ranked.display_name = ${cursor.displayName} AND ranked.player_id = ${cursor.playerId}::uuid
      AND ranked.row_id > ${cursor.rowId}::uuid)
  )`;
}

function toSeasonRow(row: SeasonDatabaseRow): SeasonLeaderRow {
  const teams = teamArraySchema.parse(row.teams);
  return {
    ...baseRankedRow(row),
    season: row.season,
    seasonType: row.season_type,
    teamContext: {
      type: teams.length === 0 ? 'NONE' : teams.length === 1 ? 'SINGLE' : 'MULTI',
      teams,
    },
    qualifyingContext: null,
  };
}

function toWeeklyRow(row: WeeklyDatabaseRow): WeeklyLeaderRow {
  return {
    ...baseRankedRow(row),
    season: row.season,
    seasonType: row.season_type,
    week: row.week,
    gameId: row.game_id,
    gameDate: row.game_date?.toISOString() ?? null,
    team: teamSummary(row.team_id, row.team_abbreviation, row.team_full_name),
    opponent: teamSummary(row.opponent_id, row.opponent_abbreviation, row.opponent_full_name),
    qualifyingContext: null,
  };
}

function toRecentRow(row: RecentDatabaseRow): RecentPerformanceRow {
  return {
    gameId: row.game_id,
    season: row.season,
    seasonType: row.season_type,
    week: row.week,
    gameDate: row.game_date?.toISOString() ?? null,
    team: teamSummary(row.team_id, row.team_abbreviation, row.team_full_name),
    opponent: teamSummary(row.opponent_id, row.opponent_abbreviation, row.opponent_full_name),
    value: row.metric_value,
  };
}

function baseRankedRow(row: RankedDatabaseRow) {
  return {
    rowId: row.row_id,
    rank: Number(row.rank),
    tied: row.tied,
    player: {
      id: row.player_id,
      displayName: row.display_name,
      position: row.position,
      positionGroup: row.position_group,
      headshotUrl: row.headshot_url,
    },
    metricValue: row.metric_value,
    games: row.games,
  };
}

function teamSummary(id: string, abbreviation: string, fullName: string): StatsTeamSummary {
  return { id, abbreviation, fullName };
}

function uniqueSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}
