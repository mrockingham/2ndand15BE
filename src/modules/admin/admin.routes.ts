import { Router, type RequestHandler } from 'express';

import { createRateLimiter } from '../../common/middleware/rate-limit.js';
import type { RateLimitConfig } from '../../config/env.js';
import {
  createRequireAdministrativeCapability,
  type AdministrativeIdentityReader,
  type AdministrativeCapability,
} from './admin-authorization.js';
import { createAdminController } from './admin.controller.js';
import type { AdministrativeScheduleService } from './admin.service.js';

export interface AdminRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: AdministrativeScheduleService;
  readonly importRateLimit: RateLimitConfig;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const controller = createAdminController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);
  const importLimit = createRateLimiter(options.importRateLimit);

  router.use(options.authenticate);
  router.get('/games', require('VIEW_SCHEDULE'), controller.listGames);
  router.get('/games/:gameId', require('VIEW_SCHEDULE'), controller.getGame);
  router.post('/games', require('EDIT_SCHEDULE'), controller.createGame);
  router.patch('/games/:gameId', require('EDIT_SCHEDULE'), controller.updateGame);
  router.put('/games/:gameId/override', require('EDIT_SCHEDULE'), controller.upsertOverride);
  router.put(
    '/games/:gameId/result-fallback',
    require('EDIT_SCHEDULE'),
    controller.upsertResultFallback,
  );
  router.delete('/games/:gameId/override', require('REMOVE_OVERRIDE'), controller.deleteOverride);
  router.put('/games/:gameId/verification', require('VERIFY_SCHEDULE'), controller.verifyGame);
  router.post(
    '/schedule-imports/validate',
    importLimit,
    require('IMPORT_SCHEDULE'),
    controller.validateImport,
  );
  router.post(
    '/schedule-imports',
    importLimit,
    require('IMPORT_SCHEDULE'),
    controller.importSchedule,
  );
  router.get('/audit-events', require('VIEW_SCHEDULE_AUDIT'), controller.listAuditEvents);
  return router;
}
