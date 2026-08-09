import { Router } from 'express';

import { createGameStatsController } from './game-stats.controller.js';
import type { GameStatsReader } from './game-stats.service.js';

export function createGameStatsRouter(reader: GameStatsReader): Router {
  const router = Router();
  router.get('/:gameId/stats', createGameStatsController(reader));
  return router;
}
