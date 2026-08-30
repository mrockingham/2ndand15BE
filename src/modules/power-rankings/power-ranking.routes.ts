import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import {
  createAdminPowerRankingController,
  createPublicPowerRankingController,
} from './power-ranking.controller.js';
import type { PowerRankingsService } from './power-ranking.service.js';

export function createPublicPowerRankingRouter(service: PowerRankingsService): Router {
  const router = Router();
  const controller = createPublicPowerRankingController(service);
  router.get('/', controller.get);
  router.get('/editions', controller.editions);
  return router;
}

export function createAdminPowerRankingRouter(options: {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: PowerRankingsService;
}): Router {
  const router = Router();
  const controller = createAdminPowerRankingController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/', require('VIEW_POWER_RANKINGS'), controller.list);
  router.post('/import', require('MANAGE_POWER_RANKINGS'), controller.import);
  router.get('/:editionId', require('VIEW_POWER_RANKINGS'), controller.detail);
  router.post('/', require('MANAGE_POWER_RANKINGS'), controller.create);
  router.patch('/:editionId', require('MANAGE_POWER_RANKINGS'), controller.update);
  router.patch(
    '/:editionId/entries/:entryId',
    require('MANAGE_POWER_RANKINGS'),
    controller.updateEntry,
  );
  router.post('/:editionId/entries/reorder', require('MANAGE_POWER_RANKINGS'), controller.reorder);
  router.post('/:editionId/publish', require('MANAGE_POWER_RANKINGS'), controller.publish);
  router.post('/:editionId/unpublish', require('MANAGE_POWER_RANKINGS'), controller.unpublish);
  return router;
}
