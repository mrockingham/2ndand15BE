import { Router } from 'express';
import { createStandingsController } from './standings.controller.js';
import type { StandingsReader } from './standings.service.js';

export function createStandingsRouter(reader: StandingsReader): Router {
  const router = Router();
  router.get('/', createStandingsController(reader));
  return router;
}
