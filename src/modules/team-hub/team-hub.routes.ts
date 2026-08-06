import { Router } from 'express';

import { createTeamHubController } from './team-hub.controller.js';
import type { TeamHubReader } from './team-hub.service.js';

export function createTeamHubRouter(reader: TeamHubReader): Router {
  const router = Router({ mergeParams: true });
  const controller = createTeamHubController(reader);
  router.get('/hub', controller.overview);
  router.get('/roster', controller.roster);
  router.get('/stat-leaders', controller.statLeaders);
  return router;
}
