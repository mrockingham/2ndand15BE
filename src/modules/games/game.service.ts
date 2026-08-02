import { AppError } from '../../common/errors/app-error.js';
import { toGameDto, type GameDto } from './game.dto.js';
import type { GameListFilters, GameRepository } from './game.repository.js';
import { parseDateBound, type GameListQuery } from './game.schemas.js';

export interface GameListResult {
  readonly games: readonly GameDto[];
  readonly nextCursor: string | null;
}
export interface GameReader {
  listGames(query: GameListQuery): Promise<GameListResult>;
  listTeamGames(teamId: string, query: Omit<GameListQuery, 'teamId'>): Promise<GameListResult>;
  getGame(gameId: string): Promise<GameDto>;
}
export interface GameQueryPolicy {
  readonly currentNflSeason: number;
  readonly allowHistoricalDefaultGameResults: boolean;
}
export class GameService implements GameReader {
  constructor(
    private readonly repository: GameRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly queryPolicy: GameQueryPolicy = {
      currentNflSeason: new Date().getUTCFullYear(),
      allowHistoricalDefaultGameResults: false,
    },
  ) {}
  async listGames(query: GameListQuery): Promise<GameListResult> {
    if (query.teamId !== undefined) await this.requireActiveTeam(query.teamId);
    return this.list(query);
  }
  async listTeamGames(
    teamId: string,
    query: Omit<GameListQuery, 'teamId'>,
  ): Promise<GameListResult> {
    await this.requireActiveTeam(teamId);
    return this.list({ ...query, teamId });
  }
  async getGame(gameId: string): Promise<GameDto> {
    const game = await this.repository.findGameById(gameId);
    if (game === null)
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The requested game was not found.',
        statusCode: 404,
      });
    return toGameDto(game);
  }
  private async list(query: GameListQuery): Promise<GameListResult> {
    const page = await this.repository.findGames(
      toRepositoryFilters(query, this.now(), this.queryPolicy),
    );
    return { games: page.games.map(toGameDto), nextCursor: page.nextCursor };
  }
  private async requireActiveTeam(teamId: string): Promise<void> {
    if (!(await this.repository.activeTeamExists(teamId)))
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        message: 'The requested active team was not found.',
        statusCode: 404,
      });
  }
}
function toRepositoryFilters(
  query: GameListQuery,
  now: Date,
  policy: GameQueryPolicy,
): GameListFilters {
  const hasDomainFilter =
    query.season !== undefined ||
    query.seasonType !== undefined ||
    query.week !== undefined ||
    query.startDate !== undefined ||
    query.teamId !== undefined ||
    query.status !== undefined;
  const dateRange = toDateRange(query, hasDomainFilter, now);
  const season =
    query.season ??
    (policy.allowHistoricalDefaultGameResults ? undefined : policy.currentNflSeason);
  return {
    ...(season === undefined ? {} : { season }),
    ...(query.seasonType === undefined ? {} : { seasonType: query.seasonType }),
    ...(query.week === undefined ? {} : { week: query.week }),
    ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    limit: query.limit,
    ...dateRange,
  };
}

function toDateRange(
  query: GameListQuery,
  hasDomainFilter: boolean,
  now: Date,
): Pick<GameListFilters, 'startTime' | 'endTime'> {
  if (query.startDate === undefined || query.endDate === undefined) {
    return hasDomainFilter
      ? {}
      : { startTime: now, endTime: new Date(now.getTime() + 14 * 86_400_000) };
  }
  return {
    startTime: parseDateBound(query.startDate, false),
    endTime: parseDateBound(query.endDate, true),
  };
}
