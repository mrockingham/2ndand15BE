import { AppError } from '../../common/errors/app-error.js';
import type { GameReader } from '../games/game.service.js';
import {
  toCurrentGamePlayerStatsDto,
  toGameTeamStatsDto,
  type CurrentGameStatsResponse,
} from './game-stats.dto.js';
import type { GameStatsRepository } from './game-stats.repository.js';

export interface GameStatsReader {
  getGameStats(gameId: string): Promise<CurrentGameStatsResponse>;
}

export class GameStatsService implements GameStatsReader {
  constructor(
    private readonly repository: GameStatsRepository,
    private readonly games: Pick<GameReader, 'getGame'>,
  ) {}

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
      },
      meta: {
        playerStatsAvailable: playerBoxScore.rows.length > 0,
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
