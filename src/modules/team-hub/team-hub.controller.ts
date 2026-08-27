import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  teamHubParamsSchema,
  teamRosterQuerySchema,
  teamStatLeadersQuerySchema,
} from './team-hub.schemas.js';
import type { TeamHubReader } from './team-hub.service.js';

export interface TeamHubController {
  readonly overview: RequestHandler;
  readonly roster: RequestHandler;
  readonly statLeaders: RequestHandler;
}

export function createTeamHubController(reader: TeamHubReader): TeamHubController {
  return {
    overview: async (request, response) => {
      const { teamId } = parse(teamHubParamsSchema, request.params);
      const result = await reader.getOverview(teamId);
      response.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      response.status(200).json(result);
    },
    roster: async (request, response) => {
      const { teamId } = parse(teamHubParamsSchema, request.params);
      const query = parse(teamRosterQuerySchema, request.query);
      const result = await reader.getRoster(teamId, query);
      response.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      response.status(200).json(result);
    },
    statLeaders: async (request, response) => {
      const { teamId } = parse(teamHubParamsSchema, request.params);
      const query = parse(teamStatLeadersQuerySchema, request.query);
      const result = await reader.getStatLeaders(teamId, query);
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
    message: 'The Team Hub request parameters are invalid.',
    statusCode: 400,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
