import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  recentPerformanceQuerySchema,
  seasonLeadersQuerySchema,
  weeklyLeadersQuerySchema,
} from './stats.schemas.js';
import type { StatsHubReader } from './stats.service.js';

export interface StatsHubController {
  readonly metadata: RequestHandler;
  readonly seasonLeaders: RequestHandler;
  readonly weeklyLeaders: RequestHandler;
  readonly recentPerformance: RequestHandler;
}

export function createStatsHubController(reader: StatsHubReader): StatsHubController {
  return {
    metadata: async (_request, response) => {
      const result = await reader.getMetadata();
      response.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      response.status(200).json(result);
    },
    seasonLeaders: async (request, response) => {
      const query = parse(seasonLeadersQuerySchema, request.query);
      const result = await reader.getSeasonLeaders(query);
      response.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
      response.status(200).json(result);
    },
    weeklyLeaders: async (request, response) => {
      const query = parse(weeklyLeadersQuerySchema, request.query);
      const result = await reader.getWeeklyLeaders(query);
      response.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
      response.status(200).json(result);
    },
    recentPerformance: async (request, response) => {
      const query = parse(recentPerformanceQuerySchema, request.query);
      const result = await reader.getRecentPerformance(query);
      response.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
      response.status(200).json(result);
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
    message: 'The Stats Hub query parameters are invalid.',
    statusCode: 400,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
