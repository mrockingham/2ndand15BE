import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { DataHealthServiceContract } from './data-health.service.js';
import {
  dataHealthGameIdParamsSchema,
  dataHealthGameListQuerySchema,
  dataHealthProbeListQuerySchema,
} from './data-health.schemas.js';

export interface DataHealthController {
  readonly listGames: RequestHandler;
  readonly getGame: RequestHandler;
  readonly listProbes: RequestHandler;
  readonly runProbe: RequestHandler;
}

export function createDataHealthController(
  service: DataHealthServiceContract,
): DataHealthController {
  return {
    listGames: async (request, response) => {
      const query = parseOrThrow(dataHealthGameListQuerySchema, request.query, 'query parameters');
      const result = await service.listGames(query);
      response.status(200).json({
        data: result.games,
        summary: result.summary,
        meta: { nextCursor: result.nextCursor },
      });
    },
    getGame: async (request, response) => {
      const { gameId } = parseOrThrow(
        dataHealthGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getGame(gameId) });
    },
    listProbes: async (request, response) => {
      const { gameId } = parseOrThrow(
        dataHealthGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      const query = parseOrThrow(dataHealthProbeListQuerySchema, request.query, 'query parameters');
      const probes = await service.listProbes(gameId, query);
      response.status(200).json({ data: probes });
    },
    runProbe: async (request, response) => {
      const { gameId } = parseOrThrow(
        dataHealthGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.runProbe(gameId) });
    },
  };
}

function parseOrThrow<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `The ${label} is invalid.`,
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
