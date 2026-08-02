import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { gameIdParamsSchema, gameListQuerySchema, teamGamesParamsSchema } from './game.schemas.js';
import type { GameReader } from './game.service.js';

export interface GameController {
  readonly list: RequestHandler;
  readonly getById: RequestHandler;
  readonly listForTeam: RequestHandler;
}
export function createGameController(gameReader: GameReader): GameController {
  return {
    list: async (request, response) => {
      const query = parseOrThrow(gameListQuerySchema, request.query, 'query parameters');
      const result = await gameReader.listGames(query);
      response.status(200).json({ data: result.games, meta: { nextCursor: result.nextCursor } });
    },
    getById: async (request, response) => {
      const params = parseOrThrow(gameIdParamsSchema, request.params, 'request parameters');
      response.status(200).json({ data: await gameReader.getGame(params.gameId) });
    },
    listForTeam: async (request, response) => {
      const params = parseOrThrow(teamGamesParamsSchema, request.params, 'request parameters');
      const query = parseOrThrow(gameListQuerySchema, request.query, 'query parameters');
      const result = await gameReader.listTeamGames(params.teamId, query);
      response.status(200).json({ data: result.games, meta: { nextCursor: result.nextCursor } });
    },
  };
}
function parseOrThrow<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `The ${label} are invalid.`,
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  return result.data;
}
