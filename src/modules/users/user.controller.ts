import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { unauthorizedError, type AuthenticationService } from '../auth/auth.service.js';
import { updateFavoriteTeamSchema } from './user.schemas.js';
import type { UserPersonalizationService } from './user.service.js';

export function createGetCurrentUserController(authService: AuthenticationService): RequestHandler {
  return async (request, response) => {
    if (request.auth === undefined) {
      throw unauthorizedError();
    }

    const user = await authService.getCurrentUser(request.auth.userId);
    response.status(200).json({ data: { user } });
  };
}

export function createUpdateFavoriteTeamController(
  userService: UserPersonalizationService,
): RequestHandler {
  return async (request, response) => {
    if (request.auth === undefined) {
      throw unauthorizedError();
    }

    const result = updateFavoriteTeamSchema.safeParse(request.body);
    if (!result.success) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'The request body is invalid.',
        statusCode: 400,
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const user = await userService.updateFavoriteTeam(
      request.auth.userId,
      result.data.favoriteTeamId,
    );
    response.status(200).json({ data: { user } });
  };
}
