import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from './admin-authorization.js';
import {
  adminGameIdParamsSchema,
  adminGameListQuerySchema,
  auditListQuerySchema,
  gameFeaturedInputSchema,
  gameOverrideInputSchema,
  gameResultFallbackInputSchema,
  manualGameCreateSchema,
  manualGameUpdateSchema,
  playsReviewQueueQuerySchema,
  repairGamePlaysInputSchema,
  scheduleImportRequestSchema,
  verificationInputSchema,
} from './admin.schemas.js';
import type { AdministrativeScheduleService } from './admin.service.js';

export interface AdminController {
  readonly listGames: RequestHandler;
  readonly getGame: RequestHandler;
  readonly createGame: RequestHandler;
  readonly updateGame: RequestHandler;
  readonly upsertOverride: RequestHandler;
  readonly upsertResultFallback: RequestHandler;
  readonly deleteOverride: RequestHandler;
  readonly setFeatured: RequestHandler;
  readonly verifyGame: RequestHandler;
  readonly validateImport: RequestHandler;
  readonly importSchedule: RequestHandler;
  readonly listAuditEvents: RequestHandler;
  readonly getPlaysDiagnostic: RequestHandler;
  readonly repairGamePlays: RequestHandler;
  readonly listPlaysReviewQueue: RequestHandler;
}

export function createAdminController(service: AdministrativeScheduleService): AdminController {
  return {
    listGames: async (request, response) => {
      const query = parseOrThrow(adminGameListQuerySchema, request.query, 'query parameters');
      const result = await service.listGames(query);
      response.status(200).json({ data: result.games, meta: { nextCursor: result.nextCursor } });
    },
    getGame: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({ data: await service.getGame(gameId) });
    },
    createGame: async (request, response) => {
      const input = parseOrThrow(manualGameCreateSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.createGame(input, requirePrincipal(request.admin), requestId(request)),
      });
    },
    updateGame: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(manualGameUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateGame(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    upsertOverride: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(gameOverrideInputSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.upsertOverride(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    upsertResultFallback: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(gameResultFallbackInputSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.upsertResultFallback(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    deleteOverride: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({
        data: await service.deleteOverride(
          gameId,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    setFeatured: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(gameFeaturedInputSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.setFeatured(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    verifyGame: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(verificationInputSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.verifyGame(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    validateImport: async (request, response) => {
      const parsed = parseOrThrow(scheduleImportRequestSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.importSchedule(
          { ...parsed, dryRun: true },
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    importSchedule: async (request, response) => {
      const input = parseOrThrow(scheduleImportRequestSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.importSchedule(
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    listAuditEvents: async (request, response) => {
      const query = parseOrThrow(auditListQuerySchema, request.query, 'query parameters');
      const result = await service.listAuditEvents(query, requirePrincipal(request.admin));
      response.status(200).json({ data: result.events, meta: { nextCursor: result.nextCursor } });
    },
    getPlaysDiagnostic: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({
        data: await service.getPlaysDiagnostic(gameId, requirePrincipal(request.admin)),
      });
    },
    repairGamePlays: async (request, response) => {
      const { gameId } = parseOrThrow(adminGameIdParamsSchema, request.params, 'path parameters');
      const input = parseOrThrow(repairGamePlaysInputSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.repairGamePlays(
          gameId,
          input,
          requirePrincipal(request.admin),
          requestId(request),
        ),
      });
    },
    listPlaysReviewQueue: async (request, response) => {
      const query = parseOrThrow(playsReviewQueueQuerySchema, request.query, 'query parameters');
      const result = await service.listPlaysReviewQueue(query, requirePrincipal(request.admin));
      response.status(200).json({
        data: result.games.map((game) => ({
          gameId: game.gameId,
          playsBlockedAt: game.playsBlockedAt?.toISOString() ?? null,
          playsBlockReason: game.playsBlockReason,
        })),
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
