import { Router, type RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  createRequireAdministrativeCapability,
  type AdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { gameHighlightsGameIdParamsSchema } from './game-highlights.schemas.js';
import type { GameHighlightsServiceContract } from './game-highlights.service.js';

function parseGameId(params: unknown): string {
  const result = gameHighlightsGameIdParamsSchema.safeParse(params);
  if (!result.success) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'The path parameters are invalid.',
      statusCode: 400,
    });
  }
  return result.data.gameId;
}

/** Public, provider-neutral read-only highlight listing -- mounted under `/games`
 * alongside game-plays/game-stats. */
export function createPublicGameHighlightsRouter(service: GameHighlightsServiceContract): Router {
  const router = Router();
  router.get('/:gameId/highlights', async (request, response) => {
    const gameId = parseGameId(request.params);
    response.status(200).json({ data: await service.getPublicHighlights(gameId) });
  });
  return router;
}

export interface AdminGameHighlightsRouterOptions {
  readonly authenticate: RequestHandler;
  readonly identities: AdministrativeIdentityReader;
  readonly service: GameHighlightsServiceContract;
}

/**
 * Explicit-check-only, mirroring Data Health exactly: the GET diagnostic is a
 * DB-only read (never calls Highlightly), and only the POST sync route makes a
 * live provider request -- gated behind the stricter `PROBE_GAME_DATA` capability,
 * same as the Data Health probe.
 */
export function createAdminGameHighlightsRouter(options: AdminGameHighlightsRouterOptions): Router {
  const router = Router();
  const require = (capability: AdministrativeCapability) =>
    createRequireAdministrativeCapability(options.identities, capability);

  router.use(options.authenticate);
  router.get(
    '/:gameId/highlights/diagnostic',
    require('VIEW_DATA_HEALTH'),
    async (request, response) => {
      const gameId = parseGameId(request.params);
      response.status(200).json({ data: await options.service.getDiagnostic(gameId) });
    },
  );
  router.post('/:gameId/highlights/sync', require('PROBE_GAME_DATA'), async (request, response) => {
    const gameId = parseGameId(request.params);
    response.status(200).json({ data: await options.service.syncGame(gameId) });
  });
  // M31C: bounded, single-game repair/backfill for embed eligibility -- never a
  // season-wide scan, and never re-fetches highlight metadata itself.
  router.post(
    '/:gameId/highlights/embed-refresh',
    require('PROBE_GAME_DATA'),
    async (request, response) => {
      const gameId = parseGameId(request.params);
      response.status(200).json({ data: await options.service.refreshEmbedEligibility(gameId) });
    },
  );
  return router;
}
