import { Router } from 'express';

import { createTeamController } from './team.controller.js';
import type { TeamReader } from './team.service.js';

export function createTeamRouter(teamReader: TeamReader): Router {
  const router = Router();
  const controller = createTeamController(teamReader);

  router.get('/', controller.list);
  router.get('/:teamId', controller.getById);

  return router;
}
