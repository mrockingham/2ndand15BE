import { Router } from 'express';

import { createStatsHubController } from './stats.controller.js';
import type { StatsHubReader } from './stats.service.js';

export function createStatsHubRouter(reader: StatsHubReader): Router {
  const router = Router();
  const controller = createStatsHubController(reader);
  router.get('/metadata', controller.metadata);
  router.get('/leaders', controller.seasonLeaders);
  router.get('/weekly-leaders', controller.weeklyLeaders);
  router.get('/recent', controller.recentPerformance);
  return router;
}
