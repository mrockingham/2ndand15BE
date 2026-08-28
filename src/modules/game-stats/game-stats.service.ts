import { AppError } from '../../common/errors/app-error.js';
import type { GameReader } from '../games/game.service.js';
import type { GameDto } from '../games/game.dto.js';
import {
  toCurrentGamePlayerStatsDto,
  toCurrentGameLeadersDto,
  toGameTeamStatsDto,
  type CurrentGameStatsResponse,
  type CurrentGameStatsListResponse,
} from './game-stats.dto.js';
import type {
  GameStatsRepository,
  PublicCurrentGameTeamStatRowWithGame,
} from './game-stats.repository.js';
import type { CurrentGameStatsListQuery } from './game-stats.schemas.js';

export interface GameStatsReader {
  getGameStats(gameId: string): Promise<CurrentGameStatsResponse>;
  listCurrentGameStats(query: CurrentGameStatsListQuery): Promise<CurrentGameStatsListResponse>;
}

export class GameStatsService implements GameStatsReader {
  constructor(
    private readonly repository: GameStatsRepository,
    private readonly games: Pick<GameReader, 'getGame'> & Partial<Pick<GameReader, 'listGames'>>,
    private readonly currentNflSeason = new Date().getUTCFullYear(),
  ) {}

  async listCurrentGameStats(
    query: CurrentGameStatsListQuery,
  ): Promise<CurrentGameStatsListResponse> {
    if (
      this.repository.findCurrentAvailability === undefined ||
      this.repository.findTeamStatsForGames === undefined ||
      this.games.listGames === undefined
    ) {
      throw new AppError({
        code: 'CURRENT_GAME_STATS_UNAVAILABLE',
        message: 'Current-season game statistics are unavailable.',
        statusCode: 503,
      });
    }
    const season = query.season ?? this.currentNflSeason;
    if (season !== this.currentNflSeason) {
      throw new AppError({
        code: 'CURRENT_GAME_STATS_CONTEXT_UNAVAILABLE',
        message: 'Current-season game statistics are unavailable for that season.',
        statusCode: 400,
      });
    }
    const availability = await this.repository.findCurrentAvailability(season);
    const supportedRows = availability.filter(isStartedContext);
    const availableSeasonTypes = uniqueSeasonTypes(supportedRows.map((row) => row.seasonType));
    const seasonType = query.seasonType ?? availableSeasonTypes[0];
    if (seasonType === undefined || !availableSeasonTypes.includes(seasonType)) {
      throw new AppError({
        code: 'CURRENT_GAME_STATS_CONTEXT_UNAVAILABLE',
        message: 'Current-season game statistics are unavailable for that season type.',
        statusCode: 400,
      });
    }
    const availableWeeks = [
      ...new Set(
        supportedRows
          .filter((row) => row.seasonType === seasonType)
          .map((row) => row.overrideWeek ?? row.week)
          .filter((week): week is number => week !== null),
      ),
    ].sort((left, right) => left - right);
    const week = query.week ?? availableWeeks.at(-1) ?? 'ALL';
    if (week !== 'ALL' && !availableWeeks.includes(week)) {
      throw new AppError({
        code: 'CURRENT_GAME_STATS_CONTEXT_UNAVAILABLE',
        message: 'Current-season game statistics are unavailable for that week.',
        statusCode: 400,
      });
    }
    const gamePage = await this.games.listGames({
      season,
      seasonType,
      ...(week === 'ALL' ? {} : { week }),
      ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
      limit: 100,
    });
    const eligibleGames = gamePage.games.filter((game) =>
      week === 'ALL' ? game.week === null || availableWeeks.includes(game.week) : true,
    );
    const rows = await this.repository.findTeamStatsForGames(eligibleGames.map((game) => game.id));
    return {
      data: {
        season,
        seasonType,
        week,
        games: eligibleGames.map((game) => toCurrentStatsGame(game, rows)),
      },
      meta: {
        availableSeasons: availableSeasonTypes.length > 0 ? [season] : [],
        availableSeasonTypes,
        availableWeeks,
        coverageNote:
          'Team statistics are available for games where current provider coverage is complete.',
      },
    };
  }

  async getGameStats(gameId: string): Promise<CurrentGameStatsResponse> {
    const game = await this.games.getGame(gameId);
    const [rows, playerBoxScore] = await Promise.all([
      this.repository.findTeamStats(gameId),
      this.repository.findPlayerBoxScore?.(gameId) ?? Promise.resolve({ rows: [], coverage: null }),
    ]);
    const home = rows.find((row) => row.isHome && row.teamId === game.homeTeam.id);
    const away = rows.find((row) => !row.isHome && row.teamId === game.awayTeam.id);
    if (home === undefined || away === undefined || rows.length !== 2) {
      throw new AppError({
        code: 'GAME_STATS_NOT_FOUND',
        message: 'Current game statistics are not available for this game.',
        statusCode: 404,
      });
    }
    if (
      playerBoxScore.rows.some(
        (row) => row.teamId !== game.homeTeam.id && row.teamId !== game.awayTeam.id,
      )
    ) {
      throw new AppError({
        code: 'GAME_STATS_INVALID',
        message: 'Stored current game statistics are inconsistent.',
        statusCode: 500,
      });
    }
    const playerStats = toCurrentGamePlayerStatsDto(
      playerBoxScore.rows,
      game.homeTeam.id,
      game.awayTeam.id,
    );
    return {
      data: {
        gameId,
        teamStats: { home: toGameTeamStatsDto(home), away: toGameTeamStatsDto(away) },
        playerStats,
        gameLeaders: toCurrentGameLeadersDto(playerStats),
      },
      meta: {
        playerStatsAvailable: playerBoxScore.rows.length > 0,
        playerStatsCoverageState: classifyPublicPlayerStats(game.status, playerBoxScore.coverage),
        playerStatsCoverage: playerBoxScore.coverage,
        limitations:
          playerBoxScore.coverage === null
            ? [
                'Player box scores are unavailable until stable internal player identities are reconciled.',
              ]
            : playerBoxScore.coverage.unresolvedRows > 0
              ? [
                  'Some player rows are omitted because stable internal identities remain unresolved.',
                ]
              : [],
      },
    };
  }
}

function classifyPublicPlayerStats(
  status: GameDto['status'],
  coverage: {
    readonly providerRows: number;
    readonly resolvedRows: number;
    readonly unresolvedRows: number;
  } | null,
): 'COMPLETE' | 'PARTIAL' | 'PENDING' | 'UNAVAILABLE' {
  if (coverage === null || coverage.providerRows === 0) {
    return status === 'FINAL' ? 'UNAVAILABLE' : 'PENDING';
  }
  return coverage.resolvedRows === coverage.providerRows && coverage.unresolvedRows === 0
    ? 'COMPLETE'
    : 'PARTIAL';
}

function isStartedContext(row: {
  readonly status: string;
  readonly overrideStatus: string | null;
  readonly teamStatRows: number;
}): boolean {
  const status = row.overrideStatus ?? row.status;
  return row.teamStatRows > 0 || ['PREGAME', 'IN_PROGRESS', 'HALFTIME', 'FINAL'].includes(status);
}

function uniqueSeasonTypes(values: readonly ('PRE' | 'REG' | 'POST')[]) {
  const order = ['PRE', 'REG', 'POST'] as const;
  return order.filter((value) => values.includes(value));
}

function toCurrentStatsGame(
  game: GameDto,
  rows: readonly PublicCurrentGameTeamStatRowWithGame[],
): CurrentGameStatsListResponse['data']['games'][number] {
  const gameRows = rows.filter((row) => row.gameId === game.id);
  const coverage = classifyPublicTeamStats(game, gameRows);
  const home = gameRows.find((row) => row.isHome && row.teamId === game.homeTeam.id);
  const away = gameRows.find((row) => !row.isHome && row.teamId === game.awayTeam.id);
  return {
    game,
    coverage: coverage === 'UNAVAILABLE' && game.status !== 'FINAL' ? 'PENDING' : coverage,
    teamStats: {
      home: home === undefined ? null : toGameTeamStatsDto(home),
      away: away === undefined ? null : toGameTeamStatsDto(away),
    },
  };
}

function classifyPublicTeamStats(
  game: GameDto,
  rows: readonly PublicCurrentGameTeamStatRowWithGame[],
): 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' {
  if (rows.length === 0) return 'UNAVAILABLE';
  const orientationValid =
    rows.length === 2 &&
    rows.some((row) => row.isHome && row.teamId === game.homeTeam.id) &&
    rows.some((row) => !row.isHome && row.teamId === game.awayTeam.id);
  const coreFields = [
    'firstDowns',
    'totalPlays',
    'totalYards',
    'passingAttempts',
    'passingYards',
    'rushingAttempts',
    'rushingYards',
    'turnovers',
  ] as const;
  return orientationValid && rows.every((row) => coreFields.every((field) => row[field] !== null))
    ? 'COMPLETE'
    : 'PARTIAL';
}
