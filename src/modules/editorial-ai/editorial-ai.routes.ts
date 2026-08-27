import { Router, type RequestHandler } from 'express';

import {
  createRequireAdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createEditorialAiController } from './editorial-ai.controller.js';
import type { EditorialAiServiceContract } from './editorial-ai.service.js';

export function createEditorialAiRouters(options: {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: EditorialAiServiceContract;
}) {
  const controller = createEditorialAiController(options.service);
  const requireEditorial = createRequireAdministrativeCapability(
    options.identities,
    'CREATE_ARTICLE',
  );
  const requireView = createRequireAdministrativeCapability(
    options.identities,
    'VIEW_EDITORIAL_CONTENT',
  );
  const requireSourceManagement = createRequireAdministrativeCapability(
    options.identities,
    'MANAGE_NEWS_SOURCES',
  );
  const candidates = Router(),
    articles = Router(),
    editorial = Router(),
    sources = Router();
  for (const router of [candidates, articles, editorial, sources]) router.use(options.authenticate);
  candidates.post('/generate-drafts', requireEditorial, controller.generateBatch);
  candidates.post('/evaluate-batch', requireEditorial, controller.evaluateBatch);
  candidates.post('/:candidateId/evaluate', requireEditorial, controller.evaluateCandidate);
  candidates.post('/:candidateId/quality-override', requireEditorial, controller.overrideQuality);
  candidates.post('/:candidateId/generate-draft', requireEditorial, controller.generateDraft);
  articles.post('/:articleId/editorial-review', requireEditorial, controller.review);
  articles.post('/:articleId/regenerate', requireEditorial, controller.regenerate);
  articles.post('/:articleId/media-candidates', requireEditorial, controller.createMedia);
  articles.post(
    '/:articleId/media/:mediaCandidateId/attach',
    requireEditorial,
    controller.attachMedia,
  );
  editorial.get('/coverage', requireView, controller.coverage);
  editorial.post(
    '/discover-launch-candidates',
    requireEditorial,
    controller.discoverLaunchCandidates,
  );
  sources.get('/:sourceId/rights', requireView, controller.getRights);
  sources.put('/:sourceId/rights', requireSourceManagement, controller.updateRights);
  return { candidates, articles, editorial, sources };
}
