import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createDataHealthController } from './data-health.controller.js';
import type { DataHealthServiceContract } from './data-health.service.js';

export interface DataHealthRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: DataHealthServiceContract;
}

export function createDataHealthRouter(options: DataHealthRouterOptions): Router {
  const router = Router();
  const controller = createDataHealthController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/games', require('VIEW_DATA_HEALTH'), controller.listGames);
  router.get('/games/:gameId', require('VIEW_DATA_HEALTH'), controller.getGame);
  router.get('/games/:gameId/probes', require('VIEW_DATA_HEALTH'), controller.listProbes);
  router.post('/games/:gameId/probe', require('PROBE_GAME_DATA'), controller.runProbe);
  return router;
}
