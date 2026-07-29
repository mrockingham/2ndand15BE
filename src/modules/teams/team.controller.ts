import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { teamIdParamsSchema } from './team.schemas.js';
import type { TeamReader } from './team.service.js';

export interface TeamController {
  readonly list: RequestHandler;
  readonly getById: RequestHandler;
}

export function createTeamController(teamReader: TeamReader): TeamController {
  return {
    list: async (_request, response) => {
      const teams = await teamReader.listActiveTeams();
      response.status(200).json({ data: teams });
    },
    getById: async (request, response) => {
      const result = teamIdParamsSchema.safeParse(request.params);

      if (!result.success) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'The request parameters are invalid.',
          statusCode: 400,
          details: result.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const team = await teamReader.getActiveTeam(result.data.teamId);
      response.status(200).json({ data: team });
    },
  };
}
