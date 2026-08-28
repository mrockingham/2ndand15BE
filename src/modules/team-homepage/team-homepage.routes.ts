import { Router, type RequestHandler } from 'express';
import {
  createRequireAdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createTeamHomepageController } from './team-homepage.controller.js';
import type { TeamHomepageServiceContract } from './team-homepage.service.js';

export function createAdminTeamHomepageRouter(options: {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: TeamHomepageServiceContract;
}): Router {
  const router = Router();
  const controller = createTeamHomepageController(options.service);
  const view = createRequireAdministrativeCapability(options.identities, 'VIEW_HOMEPAGE_CMS');
  const manage = createRequireAdministrativeCapability(options.identities, 'MANAGE_HOMEPAGE_CMS');
  router.use(options.authenticate);
  router.get('/:teamId/homepage', view, controller.getHomepage);
  router.put('/:teamId/homepage/banner', manage, controller.updateBanner);
  router.get('/:teamId/homepage/editorial', view, controller.listEditorial);
  router.get('/:teamId/homepage/editorial-candidates', view, controller.listEditorialCandidates);
  router.post('/:teamId/homepage/editorial', manage, controller.addEditorial);
  router.put('/:teamId/homepage/editorial/order', manage, controller.reorderEditorial);
  router.put('/:teamId/homepage/editorial/:placementId', manage, controller.updateEditorial);
  router.delete('/:teamId/homepage/editorial/:placementId', manage, controller.removeEditorial);
  router.get('/:teamId/homepage/highlights', view, controller.listHighlights);
  router.get('/:teamId/homepage/highlight-candidates', view, controller.listHighlightCandidates);
  router.post('/:teamId/homepage/highlights', manage, controller.addHighlight);
  router.put('/:teamId/homepage/highlights/order', manage, controller.reorderHighlights);
  router.put('/:teamId/homepage/highlights/settings', manage, controller.updateHighlightSettings);
  router.delete('/:teamId/homepage/highlights/:placementId', manage, controller.removeHighlight);
  return router;
}
