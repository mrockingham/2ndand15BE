import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import type { RateLimitConfig } from '../../config/env.js';
import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createNewsInboxController } from './news.controller.js';
import type { NewsInboxServiceContract } from './news.service.js';

export function createNewsInboxRouters(options: {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: NewsInboxServiceContract;
  readonly ingestionRateLimit: RateLimitConfig;
}): { readonly sources: Router; readonly candidates: Router } {
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);
  const controller = createNewsInboxController(options.service);
  const ingestionLimit = rateLimit({
    windowMs: options.ingestionRateLimit.windowMs,
    limit: Math.min(options.ingestionRateLimit.max, 10),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => request.auth?.userId ?? 'unauthenticated',
  });

  const sources = Router();
  sources.use(options.authenticate);
  sources.get('/', require('VIEW_NEWS_SOURCES'), controller.listSources);
  sources.get('/:sourceId', require('VIEW_NEWS_SOURCES'), controller.getSource);
  sources.post('/', require('MANAGE_NEWS_SOURCES'), controller.createSource);
  sources.patch('/:sourceId', require('MANAGE_NEWS_SOURCES'), controller.updateSource);
  sources.post('/:sourceId/pause', require('MANAGE_NEWS_SOURCES'), controller.pauseSource);
  sources.post('/:sourceId/resume', require('MANAGE_NEWS_SOURCES'), controller.resumeSource);
  sources.post(
    '/:sourceId/test',
    ingestionLimit,
    require('RUN_NEWS_INGESTION'),
    controller.testSource,
  );
  sources.post(
    '/:sourceId/ingest',
    ingestionLimit,
    require('RUN_NEWS_INGESTION'),
    controller.ingestSource,
  );

  const candidates = Router();
  candidates.use(options.authenticate);
  candidates.get('/', require('VIEW_NEWS_CANDIDATES'), controller.listCandidates);
  candidates.get('/:candidateId', require('VIEW_NEWS_CANDIDATES'), controller.getCandidate);
  candidates.post('/manual', require('REVIEW_NEWS_CANDIDATES'), controller.createManualCandidate);
  candidates.post(
    '/:candidateId/review',
    require('REVIEW_NEWS_CANDIDATES'),
    controller.reviewCandidate,
  );
  candidates.post(
    '/:candidateId/save',
    require('REVIEW_NEWS_CANDIDATES'),
    controller.saveCandidate,
  );
  candidates.post(
    '/:candidateId/dismiss',
    require('REVIEW_NEWS_CANDIDATES'),
    controller.dismissCandidate,
  );
  candidates.post(
    '/:candidateId/convert',
    require('CONVERT_NEWS_CANDIDATE'),
    controller.convertCandidate,
  );

  return { sources, candidates };
}
