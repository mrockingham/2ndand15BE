import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  adminPowerRankingListQuerySchema,
  powerRankingEditionCreateSchema,
  powerRankingEditionIdParamsSchema,
  powerRankingEditionUpdateSchema,
  powerRankingEntryParamsSchema,
  powerRankingEntryUpdateSchema,
  powerRankingImportRequestSchema,
  powerRankingReorderSchema,
  publicPowerRankingsQuerySchema,
} from './power-ranking.schemas.js';
import type { PowerRankingsService } from './power-ranking.service.js';

export function createPublicPowerRankingController(service: PowerRankingsService): {
  readonly get: RequestHandler;
  readonly editions: RequestHandler;
} {
  return {
    get: handler(async (request, response) => {
      const query = parse(publicPowerRankingsQuerySchema, request.query, 'query parameters');
      setPublicCache(response);
      response.status(200).json({ data: await service.getPublic(query.season, query.edition) });
    }),
    editions: handler(async (request, response) => {
      const query = parse(publicPowerRankingsQuerySchema, request.query, 'query parameters');
      setPublicCache(response);
      response.status(200).json({ data: await service.listPublicEditions(query.season) });
    }),
  };
}

export function createAdminPowerRankingController(service: PowerRankingsService) {
  return {
    list: handler(async (request, response) => {
      const query = parse(adminPowerRankingListQuerySchema, request.query, 'query parameters');
      const page = await service.listAdmin(query);
      response.status(200).json({ data: page.editions, meta: { nextCursor: page.nextCursor } });
    }),
    detail: handler(async (request, response) => {
      const { editionId } = parse(
        powerRankingEditionIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({ data: await service.getAdmin(editionId) });
    }),
    create: handler(async (request, response) => {
      const input = parse(powerRankingEditionCreateSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.createEdition(input, principal(request), requestId(request)),
      });
    }),
    update: handler(async (request, response) => {
      const { editionId } = parse(
        powerRankingEditionIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parse(powerRankingEditionUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateEdition(editionId, input, principal(request), requestId(request)),
      });
    }),
    updateEntry: handler(async (request, response) => {
      const { editionId, entryId } = parse(
        powerRankingEntryParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parse(powerRankingEntryUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateEntry(
          editionId,
          entryId,
          input,
          principal(request),
          requestId(request),
        ),
      });
    }),
    reorder: handler(async (request, response) => {
      const { editionId } = parse(
        powerRankingEditionIdParamsSchema,
        request.params,
        'path parameters',
      );
      const input = parse(powerRankingReorderSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.reorderEntries(
          editionId,
          input.orderedEntryIds,
          principal(request),
          requestId(request),
        ),
      });
    }),
    publish: handler(async (request, response) => {
      const { editionId } = parse(
        powerRankingEditionIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.publish(editionId, principal(request), requestId(request)),
      });
    }),
    unpublish: handler(async (request, response) => {
      const { editionId } = parse(
        powerRankingEditionIdParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.unpublish(editionId, principal(request), requestId(request)),
      });
    }),
    import: handler(async (request, response) => {
      const input = parse(powerRankingImportRequestSchema, request.body, 'request body');
      if (input.mode === 'PREVIEW') {
        response.status(200).json({ data: await service.previewImport(input.data) });
        return;
      }
      response.status(200).json({
        data: await service.upsertImport(
          input.data,
          input.publish,
          principal(request),
          requestId(request),
        ),
      });
    }),
  };
}

function handler(operation: RequestHandler): RequestHandler {
  return operation;
}

function principal(request: Request): AdministrativePrincipal {
  if (request.admin === undefined) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid administrative account is required.',
      statusCode: 401,
    });
  }
  return request.admin;
}

function requestId(request: Request): string | null {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' ? value : null;
}

function setPublicCache(response: Parameters<RequestHandler>[1]): void {
  response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
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
