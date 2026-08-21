import type { Request, RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  articleMediaParamsSchema,
  articleParamsSchema,
  candidateParamsSchema,
  coverageQuerySchema,
  editorialReviewSchema,
  evaluateBatchSchema,
  generateBatchSchema,
  generateDraftSchema,
  launchDiscoverySchema,
  sourceParamsSchema,
  sourceRightsSchema,
  mediaCandidateSchema,
  qualityOverrideSchema,
  regenerateDraftSchema,
} from './editorial-ai.schemas.js';
import type { EditorialAiServiceContract } from './editorial-ai.service.js';

export function createEditorialAiController(service: EditorialAiServiceContract) {
  return {
    generateDraft: handler(async (request, response) => {
      const { candidateId } = parse(candidateParamsSchema, request.params, 'path parameters');
      const input = parse(generateDraftSchema, request.body ?? {}, 'request body');
      response.status(201).json({
        data: await service.generateDraft(
          candidateId,
          principal(request),
          requestId(request),
          input.instruction,
        ),
      });
    }),
    generateBatch: handler(async (request, response) => {
      const input = parse(generateBatchSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.generateBatch(
          input.candidateIds,
          principal(request),
          requestId(request),
        ),
      });
    }),
    evaluateCandidate: handler(async (request, response) => {
      const { candidateId } = parse(candidateParamsSchema, request.params, 'path parameters');
      response.status(200).json({
        data: await service.evaluateCandidate(candidateId, principal(request), requestId(request)),
      });
    }),
    evaluateBatch: handler(async (request, response) => {
      const { candidateIds } = parse(evaluateBatchSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.evaluateCandidates(
          candidateIds,
          principal(request),
          requestId(request),
        ),
      });
    }),
    overrideQuality: handler(async (request, response) => {
      const { candidateId } = parse(candidateParamsSchema, request.params, 'path parameters');
      const input = parse(qualityOverrideSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.overrideCandidateQuality(
          candidateId,
          input,
          principal(request),
          requestId(request),
        ),
      });
    }),
    regenerate: handler(async (request, response) => {
      const { articleId } = parse(articleParamsSchema, request.params, 'path parameters');
      const input = parse(regenerateDraftSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.regenerateDraft(
          articleId,
          input.expectedVersion,
          principal(request),
          requestId(request),
          input.instruction,
        ),
      });
    }),
    coverage: handler(async (request, response) => {
      const { target } = parse(coverageQuerySchema, request.query, 'query parameters');
      response.status(200).json({ data: await service.coverage(target) });
    }),
    discoverLaunchCandidates: handler(async (request, response) => {
      const input = parse(launchDiscoverySchema, request.body ?? {}, 'request body');
      response.status(200).json({
        data: await service.discoverLaunchCandidates(input, principal(request), requestId(request)),
      });
    }),
    review: handler(async (request, response) => {
      const { articleId } = parse(articleParamsSchema, request.params, 'path parameters');
      const { status } = parse(editorialReviewSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.setReviewStatus(
          articleId,
          status,
          principal(request),
          requestId(request),
        ),
      });
    }),
    attachMedia: handler(async (request, response) => {
      const { articleId, mediaCandidateId } = parse(
        articleMediaParamsSchema,
        request.params,
        'path parameters',
      );
      response.status(200).json({
        data: await service.attachMedia(
          articleId,
          mediaCandidateId,
          principal(request),
          requestId(request),
        ),
      });
    }),
    createMedia: handler(async (request, response) => {
      const { articleId } = parse(articleParamsSchema, request.params, 'path parameters');
      const input = parse(mediaCandidateSchema, request.body, 'request body');
      response.status(201).json({
        data: await service.createMediaCandidate(
          articleId,
          input,
          principal(request),
          requestId(request),
        ),
      });
    }),
    getRights: handler(async (request, response) => {
      const { sourceId } = parse(sourceParamsSchema, request.params, 'path parameters');
      response.status(200).json({ data: await service.getSourceRights(sourceId) });
    }),
    updateRights: handler(async (request, response) => {
      const { sourceId } = parse(sourceParamsSchema, request.params, 'path parameters');
      const input = parse(sourceRightsSchema, request.body, 'request body');
      response.status(200).json({
        data: await service.updateSourceRights(
          sourceId,
          input,
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
  if (request.admin === undefined)
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'A valid administrative account is required.',
      statusCode: 401,
    });
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
  if (!result.success)
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `The ${label} is invalid.`,
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  return result.data;
}
