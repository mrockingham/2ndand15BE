import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import {
  createAdminArticleController,
  createPublicArticleController,
} from './article.controller.js';
import type { EditorialArticleService, PublicArticleReader } from './article.service.js';

export function createPublicArticleRouter(service: PublicArticleReader): Router {
  const router = Router();
  const controller = createPublicArticleController(service);
  router.get('/', controller.list);
  router.get('/featured', controller.featured);
  router.get('/:slug', controller.detail);
  return router;
}

export function createTeamArticleRouter(service: PublicArticleReader): Router {
  const router = Router({ mergeParams: true });
  router.get('/', createPublicArticleController(service).teamList);
  return router;
}

export function createAdminArticleRouter(options: {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: EditorialArticleService;
}): Router {
  const router = Router();
  const controller = createAdminArticleController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/', require('VIEW_EDITORIAL_CONTENT'), controller.list);
  router.get('/:articleId', require('VIEW_EDITORIAL_CONTENT'), controller.detail);
  router.post('/', require('CREATE_ARTICLE'), controller.create);
  router.patch('/:articleId', require('EDIT_ARTICLE'), controller.update);
  router.put('/:articleId/teams', require('EDIT_ARTICLE'), controller.teams);
  router.post('/:articleId/publish', require('PUBLISH_ARTICLE'), controller.publish);
  router.post('/:articleId/unpublish', require('PUBLISH_ARTICLE'), controller.unpublish);
  router.post('/:articleId/schedule', require('PUBLISH_ARTICLE'), controller.schedule);
  router.post('/:articleId/archive', require('ARCHIVE_ARTICLE'), controller.archive);
  router.post('/:articleId/restore', require('ARCHIVE_ARTICLE'), controller.restore);
  router.get('/:articleId/revisions', require('VIEW_EDITORIAL_AUDIT'), controller.revisions);
  router.get(
    '/:articleId/revisions/:revisionId',
    require('VIEW_EDITORIAL_AUDIT'),
    controller.revision,
  );
  router.delete('/:articleId', require('DELETE_ARTICLE'), controller.delete);
  return router;
}
