import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { PredictionService } from './prediction.service.js';
import {
  predictionGameParamsSchema,
  predictionGenerationSchema,
  predictionIdParamsSchema,
  predictionListSchema,
} from './prediction.schemas.js';
interface PredictionController {
  generate: RequestHandler;
  publish: RequestHandler;
  evaluate: RequestHandler;
  list: RequestHandler;
  detail: RequestHandler;
  summary: RequestHandler;
  performance: RequestHandler;
}
export function createPredictionController(service: PredictionService): PredictionController {
  return {
    generate: async (request, response) =>
      response.status(200).json({
        data: await service.generate(
          parse(predictionGenerationSchema, request.body),
          actor(request),
        ),
      }),
    publish: async (request, response) =>
      response.status(200).json({
        data: await service.publish(
          parse(predictionIdParamsSchema, request.params).predictionId,
          actor(request),
        ),
      }),
    evaluate: async (request, response) =>
      response.status(200).json({ data: await service.evaluate(actor(request)) }),
    list: async (request, response) =>
      response
        .status(200)
        .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
        .json({ data: await service.list(parse(predictionListSchema, request.query)) }),
    detail: async (request, response) =>
      response
        .status(200)
        .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
        .json({
          data: await service.detail(parse(predictionGameParamsSchema, request.params).gameId),
        }),
    summary: async (request, response) =>
      response
        .status(200)
        .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
        .json({ data: await service.summary(parse(predictionListSchema, request.query)) }),
    performance: async (_request, response) =>
      response
        .status(200)
        .set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900')
        .json({ data: await service.performance() }),
  };
}
function actor(request: Parameters<RequestHandler>[0]) {
  if (request.admin === undefined)
    throw new AppError({
      code: 'ADMIN_PERMISSION_REQUIRED',
      message: 'Administrative access is required.',
      statusCode: 403,
    });
  return {
    userId: request.admin.userId,
    emailSnapshot: request.admin.email,
    requestId: typeof request.id === 'string' ? request.id : null,
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
  if (!result.success)
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
      statusCode: 400,
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  return result.data;
}
