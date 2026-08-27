import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { gameIdParamsSchema } from '../games/game.schemas.js';
import { currentGameStatsListQuerySchema } from './game-stats.schemas.js';
import type { GameStatsReader } from './game-stats.service.js';

export function createGameStatsController(reader: GameStatsReader): RequestHandler {
  return async (request, response) => {
    const parsed = gameIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The request parameters are invalid.',
        statusCode: 400,
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    response.status(200).json(await reader.getGameStats(parsed.data.gameId));
  };
}

export function createCurrentGameStatsListController(reader: GameStatsReader): RequestHandler {
  return async (request, response) => {
    const parsed = currentGameStatsListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The query parameters are invalid.',
        statusCode: 400,
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    response.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    response.status(200).json(await reader.listCurrentGameStats(parsed.data));
  };
}
