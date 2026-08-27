import { Router, type RequestHandler } from 'express';

import { createRateLimiter } from '../../common/middleware/rate-limit.js';
import type { RateLimitConfig } from '../../config/env.js';
import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createContactController } from './contact.controller.js';
import type { ContactServiceContract } from './contact.service.js';

export interface PublicContactRouterOptions {
  readonly service: ContactServiceContract;
  readonly rateLimit: RateLimitConfig;
}

/** Public contact form submission. Rate-limited separately from general API
 * traffic (CONTACT_RATE_LIMIT_*) -- see docs/production/contact.md. */
export function createPublicContactRouter(options: PublicContactRouterOptions): Router {
  const router = Router();
  const controller = createContactController(options.service);
  router.post('/', createRateLimiter(options.rateLimit), controller.submit);
  return router;
}

export interface AdminContactRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: ContactServiceContract;
}

/** Viewing/triage is available to EDITOR + ADMIN (`VIEW_CONTACT_MESSAGES`);
 * changing a message's status requires `MANAGE_CONTACT_MESSAGES`, ADMIN-only
 * -- contact triage is an operational/support action, matching the
 * ops-oriented `PROBE_GAME_DATA`/`REPAIR_GAME_PLAYS` ADMIN-only split rather
 * than the editorial-content precedent used for homepage/article management. */
export function createAdminContactRouter(options: AdminContactRouterOptions): Router {
  const router = Router();
  const controller = createContactController(options.service);
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get('/', require('VIEW_CONTACT_MESSAGES'), controller.list);
  router.get('/:contactMessageId', require('VIEW_CONTACT_MESSAGES'), controller.get);
  router.patch('/:contactMessageId', require('MANAGE_CONTACT_MESSAGES'), controller.updateStatus);
  return router;
}
