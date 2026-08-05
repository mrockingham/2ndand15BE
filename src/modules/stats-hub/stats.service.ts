import { AppError } from '../../common/errors/app-error.js';
import { decodeStatsCursor, encodeStatsCursor, type StatsCursor } from './stats-cursor.js';
import {
  STATS_PUBLIC_ATTRIBUTION,
  metricResponse,
  type RecentPerformanceRow,
  type RankedStatsRow,
} from './stats.dto.js';
import {
  findStatsMetric,
  STATS_API_VERSION,
  STATS_CATEGORY_ORDER,
  STATS_METRICS,
  toPublicMetricDefinition,
  type StatsMetricContext,
  type StatsMetricDefinition,
} from './stats-metrics.js';
import type { StatsHubRepository } from './stats.repository.js';
import type {
  RecentPerformanceQuery,
  SeasonLeadersQuery,
  WeeklyLeadersQuery,
} from './stats.schemas.js';

export interface StatsHubReader {
  getMetadata(): Promise<unknown>;
  getSeasonLeaders(query: SeasonLeadersQuery): Promise<unknown>;
  getWeeklyLeaders(query: WeeklyLeadersQuery): Promise<unknown>;
  getRecentPerformance(query: RecentPerformanceQuery): Promise<unknown>;
}

export class StatsHubService implements StatsHubReader {
  constructor(private readonly repository: StatsHubRepository) {}

  async getMetadata() {
    const metadata = await this.repository.findMetadata();
    return {
      data: {
        apiVersion: STATS_API_VERSION,
        availableSeasons: metadata.seasons,
        seasonTypes: {
          seasonLeaders: ['REG', 'POST', 'REG_POST'],
          weeklyLeaders: ['REG', 'POST'],
          recentPerformance: ['REG', 'POST'],
        },
        categories: STATS_CATEGORY_ORDER.map((id) => ({ id, label: categoryLabel(id) })),
        metrics: STATS_METRICS.map(toPublicMetricDefinition),
        positions: metadata.positions,
        positionGroups: metadata.positionGroups,
        limits: {
          leaderboards: { default: 25, maximum: 100 },
          recentGames: { default: 5, maximum: 20 },
        },
        ranking: {
          method: 'COMPETITION',
          tieExample: [1, 2, 2, 4],
          tieOrder: ['games_desc', 'display_name_asc', 'player_id_asc'],
        },
        coverageNotes: [
          'Historical player statistics cover imported 2020-2025 records only.',
          'Null metric values are excluded from leaderboards; recorded zeroes remain eligible.',
          'No live 2026 player statistics, projections, or predictions are included.',
        ],
      },
      meta: { attribution: STATS_PUBLIC_ATTRIBUTION },
    };
  }

  async getSeasonLeaders(query: SeasonLeadersQuery) {
    const metric = requireMetric(query.metric, 'SEASON');
    await this.validateFilters(query.season, query.position, query.positionGroup, query.teamId);
    const cursor = decodeOptionalCursor(query.cursor, 'SEASON', metric.id);
    const page = await this.repository.findSeasonLeaders(metric, { ...query, cursor });
    return rankedResponse(metric, page.rows, page.hasMore, 'SEASON');
  }

  async getWeeklyLeaders(query: WeeklyLeadersQuery) {
    const metric = requireMetric(query.metric, 'WEEK');
    await this.validateFilters(query.season, query.position, query.positionGroup, query.teamId);
    const cursor = decodeOptionalCursor(query.cursor, 'WEEK', metric.id);
    const page = await this.repository.findWeeklyLeaders(metric, { ...query, cursor });
    return rankedResponse(metric, page.rows, page.hasMore, 'WEEK');
  }

  async getRecentPerformance(query: RecentPerformanceQuery) {
    const metric = requireMetric(query.metric, 'RECENT');
    const [player, seasonExists] = await Promise.all([
      this.repository.findPlayer(query.playerId),
      query.season === undefined
        ? Promise.resolve(true)
        : this.repository.seasonExists(query.season),
    ]);
    if (player === null)
      throw new AppError({
        code: 'PLAYER_NOT_FOUND',
        message: 'The requested player was not found.',
        statusCode: 404,
      });
    if (!seasonExists) unavailableSeason(query.season);
    const performances = await this.repository.findRecent(metric, query);
    const knownValues = performances
      .map(({ value }) => value)
      .filter((value): value is number => value !== null);
    return {
      data: {
        player,
        performances,
        summary: summarize(knownValues, performances),
      },
      meta: {
        metric: metricResponse(metric),
        attribution: STATS_PUBLIC_ATTRIBUTION,
      },
    };
  }

  private async validateFilters(
    season: number,
    position: string | undefined,
    positionGroup: string | undefined,
    teamId: string | undefined,
  ): Promise<void> {
    const needsMetadata = position !== undefined || positionGroup !== undefined;
    const [seasonExists, teamExists, metadata] = await Promise.all([
      this.repository.seasonExists(season),
      teamId === undefined ? Promise.resolve(true) : this.repository.teamExists(teamId),
      needsMetadata ? this.repository.findMetadata() : Promise.resolve(undefined),
    ]);
    if (!seasonExists) unavailableSeason(season);
    if (!teamExists)
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        message: 'The requested team was not found.',
        statusCode: 404,
      });
    if (position !== undefined && !metadata?.positions.includes(position))
      unsupportedPosition('position', position);
    if (positionGroup !== undefined && !metadata?.positionGroups.includes(positionGroup))
      unsupportedPosition('positionGroup', positionGroup);
  }
}

function requireMetric(id: string, context: StatsMetricContext): StatsMetricDefinition {
  const metric = findStatsMetric(id);
  if (metric === undefined)
    throw new AppError({
      code: 'STATS_METRIC_NOT_FOUND',
      message: 'The requested Stats Hub metric is not supported.',
      statusCode: 404,
    });
  const supported =
    context === 'SEASON'
      ? metric.availableForSeasonLeaders
      : context === 'WEEK'
        ? metric.availableForWeekLeaders
        : metric.availableForRecentPerformance;
  if (!supported)
    throw new AppError({
      code:
        context === 'SEASON'
          ? 'STATS_METRIC_NOT_SUPPORTED_FOR_SEASON'
          : context === 'WEEK'
            ? 'STATS_METRIC_NOT_SUPPORTED_FOR_WEEK'
            : 'STATS_METRIC_NOT_SUPPORTED_FOR_RECENT',
      message: 'The requested metric is not supported for this Stats Hub context.',
      statusCode: 400,
    });
  return metric;
}

function decodeOptionalCursor(
  cursor: string | undefined,
  context: 'SEASON' | 'WEEK',
  metric: string,
): StatsCursor | undefined {
  return cursor === undefined ? undefined : decodeStatsCursor(cursor, { context, metric });
}

function rankedResponse<T extends RankedStatsRow>(
  metric: StatsMetricDefinition,
  rows: readonly T[],
  hasMore: boolean,
  context: 'SEASON' | 'WEEK',
) {
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last !== undefined
      ? encodeStatsCursor({
          version: 1,
          context,
          metric: metric.id,
          value: last.metricValue,
          games: last.games,
          displayName: last.player.displayName,
          playerId: last.player.id,
          rowId: last.rowId,
        })
      : null;
  return {
    data: rows.map(withoutCursorRowId),
    meta: {
      nextCursor,
      metric: metricResponse(metric),
      ranking: { method: 'COMPETITION', tiedValuesShareRank: true },
      attribution: STATS_PUBLIC_ATTRIBUTION,
    },
  };
}

function withoutCursorRowId<T extends RankedStatsRow>(row: T): Omit<T, 'rowId'> {
  const publicRow: { -readonly [Key in keyof T]?: T[Key] } = { ...row };
  delete publicRow.rowId;
  return publicRow as Omit<T, 'rowId'>;
}

function summarize(values: readonly number[], performances: readonly RecentPerformanceRow[]) {
  if (values.length === 0)
    return {
      gamesRepresented: performances.length,
      valuesRepresented: 0,
      missingDataCount: performances.length,
      average: null,
      total: null,
      minimum: null,
      maximum: null,
    };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    gamesRepresented: performances.length,
    valuesRepresented: values.length,
    missingDataCount: performances.length - values.length,
    average: total / values.length,
    total,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

function unavailableSeason(season: number | undefined): never {
  throw new AppError({
    code: 'STATS_SEASON_NOT_AVAILABLE',
    message: `Historical player statistics are not available for season ${String(season)}.`,
    statusCode: 400,
  });
}

function unsupportedPosition(field: string, value: string): never {
  throw new AppError({
    code: 'STATS_POSITION_NOT_SUPPORTED',
    message: `The requested ${field} value ${value} is not available.`,
    statusCode: 400,
  });
}

function categoryLabel(category: (typeof STATS_CATEGORY_ORDER)[number]): string {
  return category.charAt(0) + category.slice(1).toLowerCase();
}
