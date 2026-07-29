import { Router } from 'express';

import { createHealthController, type HealthControllerOptions } from './health.controller.js';

export function createHealthRouter(options: HealthControllerOptions = {}): Router {
  const router = Router();
  router.get('/', createHealthController(options));
  return router;
}
