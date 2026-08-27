import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  createCuratedVideoSchema,
  gameMediaGameIdParamsSchema,
  gameMediaVideoIdParamsSchema,
  gameMediaWeekQuerySchema,
  reorderCuratedVideosSchema,
  setGlobalGameCenterVideoSchema,
  updateCuratedVideoSchema,
} from './game-media-curation.schemas.js';
import type { GameMediaCurationServiceContract } from './game-media-curation.service.js';

export interface GameMediaCurationController {
  readonly listGames: RequestHandler;
  readonly getGameMedia: RequestHandler;
  readonly addVideo: RequestHandler;
  readonly updateVideo: RequestHandler;
  readonly reorderVideos: RequestHandler;
  readonly deleteVideo: RequestHandler;
  readonly getPublicMedia: RequestHandler;
  readonly getGlobalVideo: RequestHandler;
  readonly setGlobalVideo: RequestHandler;
  readonly removeGlobalVideo: RequestHandler;
}

export function createGameMediaCurationController(
  service: GameMediaCurationServiceContract,
): GameMediaCurationController {
  return {
    listGames: async (request, response) => {
      const query = parseOrThrow(gameMediaWeekQuerySchema, request.query, 'query parameters');
      response.status(200).json({ data: await service.listGamesForWeek(query) });
    },
    getGameMedia: async (request, response) => {
      const { gameId } = parseOrThrow(
        gameMediaGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getGameMediaDetail(gameId) });
    },
    addVideo: async (request, response) => {
      const { gameId } = parseOrThrow(
        gameMediaGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parseOrThrow(createCuratedVideoSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.addVideo(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    updateVideo: async (request, response) => {
      const { videoId } = parseOrThrow(
        gameMediaVideoIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parseOrThrow(updateCuratedVideoSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateVideo(
          videoId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    reorderVideos: async (request, response) => {
      const { gameId } = parseOrThrow(
        gameMediaGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      const { videoIds } = parseOrThrow(reorderCuratedVideosSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.reorderVideos(
          gameId,
          videoIds,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    deleteVideo: async (request, response) => {
      const { videoId } = parseOrThrow(
        gameMediaVideoIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.deleteVideo(
          videoId,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    getPublicMedia: async (request, response) => {
      const { gameId } = parseOrThrow(
        gameMediaGameIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getPublicGameMedia(gameId) });
    },
    getGlobalVideo: async (_request, response) => {
      response.status(200).json({ data: await service.getGlobalVideo() });
    },
    setGlobalVideo: async (request, response) => {
      const input = parseOrThrow(setGlobalGameCenterVideoSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.setGlobalVideo(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    removeGlobalVideo: async (request, response) => {
      response.status(200).json({
        data: await service.removeGlobalVideo(requirePrincipal(request.admin), requestId(request)),
      });
    },
  };
}

function requirePrincipal(principal: AdministrativePrincipal | undefined): AdministrativePrincipal {
  if (principal === undefined) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid access token is required.',
      statusCode: 401,
    });
  }
  return principal;
}

function requestId(request: Request): string | null {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : null;
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
