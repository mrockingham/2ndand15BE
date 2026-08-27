import { AppError } from '../../common/errors/app-error.js';
import type { GameDto } from '../games/game.dto.js';
import type { GameReader } from '../games/game.service.js';
import type { GamePlaysResponse } from './game-plays.dto.js';
import type { GamePlayRepository } from './game-plays.repository.js';

export interface GamePlayReader {
  getGamePlays(gameId: string): Promise<GamePlaysResponse>;
}

export class GamePlayService implements GamePlayReader {
  constructor(
    private readonly repository: GamePlayRepository,
    private readonly games: Pick<GameReader, 'getGame'>,
  ) {}

  async getGamePlays(gameId: string): Promise<GamePlaysResponse> {
    const game = await this.games.getGame(gameId);
    const rows = await this.repository.findPlays(gameId);
    if (
      rows.some(
        (row) =>
          row.possessionTeamId !== null &&
          row.possessionTeamId !== game.homeTeam.id &&
          row.possessionTeamId !== game.awayTeam.id,
      )
    ) {
      throw new AppError({
        code: 'GAME_PLAYS_INVALID',
        message: 'Stored game plays are inconsistent.',
        statusCode: 500,
      });
    }
    return {
      data: {
        gameId,
        playCount: rows.length,
        plays: rows.map((row) => ({
          id: row.id,
          sequence: row.sequence,
          period: row.period,
          clock: row.clock,
          possessionTeam:
            row.possessionTeamId === game.homeTeam.id
              ? game.homeTeam
              : row.possessionTeamId === game.awayTeam.id
                ? game.awayTeam
                : null,
          type: row.playType,
          description: row.description,
          start: { down: row.startDown, distance: row.startDistance, yardLine: row.startYardLine },
          end: { down: row.endDown, distance: row.endDistance, yardLine: row.endYardLine },
          flags: {
            scoring: row.isScoringPlay,
            penalty: row.isPenalty,
            turnover: row.isTurnover,
          },
        })),
      },
      meta: {
        limitations: rows.length === 0 ? [emptyPlaysLimitation(game.status)] : [],
      },
    };
  }
}

function emptyPlaysLimitation(status: GameDto['status']): string {
  return status === 'FINAL'
    ? 'Structured play-by-play has not been imported for this completed game.'
    : 'Structured play-by-play is not available yet for this game.';
}
