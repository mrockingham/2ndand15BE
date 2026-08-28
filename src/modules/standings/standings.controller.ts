import type { RequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { standingsQuerySchema } from './standings.schemas.js';
import type { StandingsReader } from './standings.service.js';

export function createStandingsController(reader: StandingsReader): RequestHandler {
  return async (request, response) => {
    const parsed = standingsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The query parameters are invalid.',
        statusCode: 400,
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    response.set('Cache-Control', 'public, max-age=300');
    response.status(200).json(await reader.getStandings(parsed.data));
  };
}
