import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { AiHubWeeklyInsightsService } from './weekly-insights.service.js';
import { weeklyInsightsQuerySchema } from './weekly-insights.schemas.js';

export function createWeeklyInsightsController(
  service: AiHubWeeklyInsightsService,
): RequestHandler {
  return async (request, response) => {
    const result = weeklyInsightsQuerySchema.safeParse(request.query);
    if (!result.success)
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The query parameters are invalid.',
        statusCode: 400,
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    response
      .status(200)
      .set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900')
      .json({ data: await service.getWeeklyInsights(result.data) });
  };
}
