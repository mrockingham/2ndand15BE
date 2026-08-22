import { Router } from 'express';

import { createGamePlayController } from './game-plays.controller.js';
import type { GamePlayReader } from './game-plays.service.js';

export function createGamePlayRouter(reader: GamePlayReader): Router {
  const router = Router();
  router.get('/:gameId/plays', createGamePlayController(reader));
  return router;
}
