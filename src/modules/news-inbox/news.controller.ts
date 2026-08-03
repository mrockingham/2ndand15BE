import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  candidateIdParamsSchema,
  manualCandidateCreateSchema,
  newsCandidateActionSchema,
  newsCandidateConvertSchema,
  newsCandidateDismissSchema,
  newsCandidateListQuerySchema,
  newsSourceCreateSchema,
  newsSourceListQuerySchema,
  newsSourceUpdateSchema,
  sourceIdParamsSchema,
} from './news.schemas.js';
import type { NewsInboxServiceContract } from './news.service.js';

export function createNewsInboxController(service: NewsInboxServiceContract) {
  return {
    listSources: handler(async (request, response) => {
      const query = parse(newsSourceListQuerySchema, request.query, 'query parameters');
      const page = await service.listSources(query);
      response.status(200).json({ data: page.sources, meta: { nextCursor: page.nextCursor } });
    }),
    getSource: handler(async (request, response) => {
      const { sourceId } = parse(sourceIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({ data: await service.getSource(sourceId) });
    }),
    createSource: handler(async (request, response) => {
      const input = parse(newsSourceCreateSchema, request.body, 'request body');
      response
        .status(201)
        .json({ data: await service.createSource(input, principal(request), requestId(request)) });
    }),
    updateSource: handler(async (request, response) => {
      const { sourceId } = parse(sourceIdParamsSchema, request.params, 'path parameters');
      const input = parse(newsSourceUpdateSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateSource(sourceId, input, principal(request), requestId(request)),
      });
    }),
    pauseSource: sourceAction((id, actor, idempotency) =>
      service.pauseSource(id, actor, idempotency),
    ),
    resumeSource: sourceAction((id, actor, idempotency) =>
      service.resumeSource(id, actor, idempotency),
    ),
    testSource: sourceAction((id, actor, idempotency) =>
      service.testSource(id, actor, idempotency),
    ),
    ingestSource: sourceAction((id, actor, idempotency) =>
      service.ingestSource(id, actor, idempotency),
    ),
    listCandidates: handler(async (request, response) => {
      const query = parse(newsCandidateListQuerySchema, request.query, 'query parameters');
      const page = await service.listCandidates(query);
      response.status(200).json({ data: page.candidates, meta: { nextCursor: page.nextCursor } });
    }),
    getCandidate: handler(async (request, response) => {
      const { candidateId } = parse(candidateIdParamsSchema, request.params, 'path parameters');
      response.status(200).json({ data: await service.getCandidate(candidateId) });
    }),
    createManualCandidate: handler(async (request, response) => {
      const input = parse(manualCandidateCreateSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.createManualCandidate(input, principal(request), requestId(request)),
      });
    }),
    reviewCandidate: candidateAction((id, actor, idempotency) =>
      service.reviewCandidate(id, actor, idempotency),
    ),
    saveCandidate: candidateAction((id, actor, idempotency) =>
      service.saveCandidate(id, actor, idempotency),
    ),
    dismissCandidate: handler(async (request, response) => {
      const { candidateId } = parse(candidateIdParamsSchema, request.params, 'path parameters');
      const { reason } = parse(newsCandidateDismissSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.dismissCandidate(
          candidateId,
          reason,
          principal(request),
          requestId(request),
        ),
      });
    }),
    convertCandidate: handler(async (request, response) => {
      const { candidateId } = parse(candidateIdParamsSchema, request.params, 'path parameters');
      const input = parse(newsCandidateConvertSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.convertCandidate(
          candidateId,
          input,
          principal(request),
          requestId(request),
        ),
      });
    }),
  };

  function sourceAction(
    operation: (
      id: string,
      actor: AdministrativePrincipal,
      requestId: string | null,
    ) => Promise<unknown>,
  ): RequestHandler {
    return handler(async (request, response) => {
      const { sourceId } = parse(sourceIdParamsSchema, request.params, 'path parameters');
      parse(newsCandidateActionSchema, request.body ?? {}, 'request body');
      response
        .status(200)
        .json({ data: await operation(sourceId, principal(request), requestId(request)) });
    });
  }

  function candidateAction(
    operation: (
      id: string,
      actor: AdministrativePrincipal,
      requestId: string | null,
    ) => Promise<unknown>,
  ): RequestHandler {
    return handler(async (request, response) => {
      const { candidateId } = parse(candidateIdParamsSchema, request.params, 'path parameters');
      parse(newsCandidateActionSchema, request.body ?? {}, 'request body');
      response
        .status(200)
        .json({ data: await operation(candidateId, principal(request), requestId(request)) });
    });
  }
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
