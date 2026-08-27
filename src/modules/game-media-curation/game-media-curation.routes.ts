import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createGameMediaCurationController } from './game-media-curation.controller.js';
import type { GameMediaCurationServiceContract } from './game-media-curation.service.js';

/** Public, provider-neutral read-only Game Center media -- mounted under
 * `/games` alongside game-plays/game-stats/game-highlights. */
export function createPublicGameMediaRouter(service: GameMediaCurationServiceContract): Router {
  const router = Router();
  const controller = createGameMediaCurationController(service);
  router.get('/:gameId/media', controller.getPublicMedia);
  return router;
}

export interface AdminGameMediaCurationRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: GameMediaCurationServiceContract;
}

/**
 * M32: viewing is available to EDITOR + ADMIN (`VIEW_GAME_MEDIA`); every
 * mutation (create/update/reorder/delete) requires `MANAGE_GAME_MEDIA`,
 * ADMIN-only for now -- matches the `PROBE_GAME_DATA`/`VIEW_DATA_HEALTH` split
 * already used for the Data Health and game-highlights admin routes.
 */
export function createAdminGameMediaCurationRouter(
  options: AdminGameMediaCurationRouterOptions,
): Router {
  const router = Router();
  const controller = createGameMediaCurationController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/games', require('VIEW_GAME_MEDIA'), controller.listGames);
  router.get('/games/:gameId', require('VIEW_GAME_MEDIA'), controller.getGameMedia);
  router.post('/games/:gameId/videos', require('MANAGE_GAME_MEDIA'), controller.addVideo);
  router.patch('/videos/:videoId', require('MANAGE_GAME_MEDIA'), controller.updateVideo);
  router.put('/games/:gameId/videos/order', require('MANAGE_GAME_MEDIA'), controller.reorderVideos);
  router.delete('/videos/:videoId', require('MANAGE_GAME_MEDIA'), controller.deleteVideo);
  // M32B: the single cross-game global video -- a distinct top-level path,
  // never a `:gameId` sub-resource (it belongs to no one game).
  router.get('/global-video', require('VIEW_GAME_MEDIA'), controller.getGlobalVideo);
  router.put('/global-video', require('MANAGE_GAME_MEDIA'), controller.setGlobalVideo);
  router.delete('/global-video', require('MANAGE_GAME_MEDIA'), controller.removeGlobalVideo);
  return router;
}
