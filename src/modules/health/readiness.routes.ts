import { Router } from 'express';

import {
  createReadinessController,
  type ReadinessControllerOptions,
} from './readiness.controller.js';

export function createReadinessRouter(options: ReadinessControllerOptions): Router {
  const router = Router();
  router.get('/', createReadinessController(options));
  return router;
}
