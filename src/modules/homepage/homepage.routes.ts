import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createHomepageController } from './homepage.controller.js';
import type { HomepageServiceContract } from './homepage.service.js';

/** Public, provider-neutral, DB-backed homepage composition -- one request,
 * no N+1 game-media lookups from the frontend. */
export function createPublicHomepageRouter(service: HomepageServiceContract): Router {
  const router = Router();
  const controller = createHomepageController(service);
  router.get('/', controller.getPublicHomepage);
  return router;
}

export interface AdminHomepageRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: HomepageServiceContract;
}

/**
 * M35A: viewing is available to EDITOR + ADMIN (`VIEW_HOMEPAGE_CMS`); every
 * mutation (create/update/delete/reorder Hero slides, mark/unmark/reorder Top
 * Stories) requires `MANAGE_HOMEPAGE_CMS`, granted to both EDITOR and ADMIN --
 * homepage curation is editorial content management, matching the
 * `EDIT_ARTICLE`/`PUBLISH_ARTICLE` precedent (both EDITOR-accessible) rather
 * than the ops-oriented `PROBE_GAME_DATA`/`REPAIR_GAME_PLAYS` (ADMIN-only)
 * split used elsewhere.
 */
export function createAdminHomepageRouter(options: AdminHomepageRouterOptions): Router {
  const router = Router();
  const controller = createHomepageController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/hero', require('VIEW_HOMEPAGE_CMS'), controller.listHeroSlides);
  router.get('/hero/:slideId', require('VIEW_HOMEPAGE_CMS'), controller.getHeroSlide);
  router.post('/hero', require('MANAGE_HOMEPAGE_CMS'), controller.createHeroSlide);
  router.patch('/hero/:slideId', require('MANAGE_HOMEPAGE_CMS'), controller.updateHeroSlide);
  router.delete('/hero/:slideId', require('MANAGE_HOMEPAGE_CMS'), controller.deleteHeroSlide);
  router.put('/hero/order', require('MANAGE_HOMEPAGE_CMS'), controller.reorderHeroSlides);

  router.get('/top-stories', require('VIEW_HOMEPAGE_CMS'), controller.listTopStories);
  // Registered before `/top-stories/:articleId` -- both are PUT, and Express
  // matches route order, so `/order` must not be shadowed by the param route.
  router.put('/top-stories/order', require('MANAGE_HOMEPAGE_CMS'), controller.reorderTopStories);
  router.put('/top-stories/:articleId', require('MANAGE_HOMEPAGE_CMS'), controller.markTopStory);
  router.delete(
    '/top-stories/:articleId',
    require('MANAGE_HOMEPAGE_CMS'),
    controller.unmarkTopStory,
  );

  // M37A: Homepage highlight curation. `/highlight-candidates` and
  // `/highlights/order`/`/highlights/settings` are registered as their own
  // static paths before `/highlights/:placementId` so Express's route-order
  // matching never shadows them (same precaution as `/top-stories/order`).
  router.get(
    '/highlight-candidates',
    require('VIEW_HOMEPAGE_CMS'),
    controller.listHighlightCandidates,
  );
  router.get('/highlights', require('VIEW_HOMEPAGE_CMS'), controller.listHighlightPlacements);
  router.post('/highlights', require('MANAGE_HOMEPAGE_CMS'), controller.addHighlightPlacement);
  router.put(
    '/highlights/order',
    require('MANAGE_HOMEPAGE_CMS'),
    controller.reorderHighlightPlacements,
  );
  router.put(
    '/highlights/settings',
    require('MANAGE_HOMEPAGE_CMS'),
    controller.updateHighlightSettings,
  );
  router.delete(
    '/highlights/:placementId',
    require('MANAGE_HOMEPAGE_CMS'),
    controller.removeHighlightPlacement,
  );

  return router;
}
