import { Router, type RequestHandler } from 'express';

import type { AuthenticationService } from '../auth/auth.service.js';
import {
  createGetCurrentUserController,
  createUpdateFavoriteTeamController,
} from './user.controller.js';
import type { UserPersonalizationService } from './user.service.js';

export function createUserRouter(
  authService: AuthenticationService,
  userService: UserPersonalizationService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.get('/me', authenticate, createGetCurrentUserController(authService));
  router.patch('/me/favorite-team', authenticate, createUpdateFavoriteTeamController(userService));
  return router;
}
