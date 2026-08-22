import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { gameIdParamsSchema } from '../games/game.schemas.js';
import type { GamePlayReader } from './game-plays.service.js';

export function createGamePlayController(reader: GamePlayReader): RequestHandler {
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
    response.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    response.status(200).json(await reader.getGamePlays(parsed.data.gameId));
  };
}
