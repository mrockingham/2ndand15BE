import { Router } from 'express';
import { createGameController } from './game.controller.js';
import type { GameReader } from './game.service.js';
export function createGameRouter(gameReader: GameReader): Router {
  const router = Router();
  const controller = createGameController(gameReader);
  router.get('/', controller.list);
  router.get('/:gameId', controller.getById);
  return router;
}
export function createTeamGameRouter(gameReader: GameReader): Router {
  const router = Router({ mergeParams: true });
  router.get('/', createGameController(gameReader).listForTeam);
  return router;
}
