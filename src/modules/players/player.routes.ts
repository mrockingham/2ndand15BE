import { Router } from 'express';
import { createPlayerController } from './player.controller.js';
import type { PlayerReader } from './player.service.js';

export function createPlayerRouter(reader: PlayerReader): Router {
  const router = Router();
  const controller = createPlayerController(reader);
  router.get('/', controller.list);
  router.get('/:playerId', controller.detail);
  router.get('/:playerId/stats', controller.stats);
  router.get('/:playerId/seasons', controller.seasons);
  return router;
}
