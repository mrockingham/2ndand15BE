import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import {
  playerIdParamsSchema,
  playerListQuerySchema,
  playerStatsQuerySchema,
} from './player.schemas.js';
import type { PlayerReader } from './player.service.js';

export function createPlayerController(reader: PlayerReader): {
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
  readonly stats: RequestHandler;
  readonly seasons: RequestHandler;
} {
  return {
    list: async (request, response) => {
      const query = parse(playerListQuerySchema, request.query);
      response.status(200).json(await reader.listPlayers(query));
    },
    detail: async (request, response) => {
      const { playerId } = parse(playerIdParamsSchema, request.params);
      response.status(200).json(await reader.getPlayer(playerId));
    },
    stats: async (request, response) => {
      const { playerId } = parse(playerIdParamsSchema, request.params);
      const query = parse(playerStatsQuerySchema, request.query);
      response.status(200).json(await reader.getPlayerStats(playerId, query));
    },
    seasons: async (request, response) => {
      const { playerId } = parse(playerIdParamsSchema, request.params);
      response.status(200).json(await reader.getPlayerSeasons(playerId));
    },
  };
}

function parse<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError({
    code: 'VALIDATION_ERROR',
    message: 'The request input is invalid.',
    statusCode: 400,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
