/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { createDataHealthRouter } from './data-health.routes.js';
import type { DataHealthServiceContract } from './data-health.service.js';

const adminUserId = '00000000-0000-4000-8000-000000000001';
const editorUserId = '00000000-0000-4000-8000-000000000002';
const gameId = '00000000-0000-4000-8000-000000000100';

function service(): DataHealthServiceContract {
  return {
    listGames: vi.fn().mockResolvedValue({
      games: [],
      summary: {
        games: 0,
        resultsComplete: 0,
        resultsMissing: 0,
        teamStatsComplete: 0,
        teamStatsMissing: 0,
        playerStatsComplete: 0,
        playerStatsMissing: 0,
        playsAvailable: 0,
        needsInvestigation: 0,
      },
      nextCursor: null,
    }),
    getGame: vi.fn().mockResolvedValue({ gameId, status: 'FINAL' }),
    listProbes: vi.fn().mockResolvedValue([]),
    runProbe: vi.fn().mockResolvedValue({
      gameId,
      checkedAt: new Date().toISOString(),
      provider: {
        reachable: true,
        matchFound: true,
        requestCount: 2,
        durationMs: 120,
        quotaLimit: 7500,
        quotaRemaining: 6800,
      },
      result: {
        providerAvailable: true,
        providerStatus: 'FINAL',
        scoreAvailable: true,
        diagnosis: 'RESULT_COMPLETE',
        explanation: 'ok',
      },
      teamStats: {
        providerAvailable: true,
        rawRows: 2,
        normalizedRows: 2,
        databaseRows: 2,
        diagnosis: 'TEAM_STATS_COMPLETE',
        explanation: 'ok',
      },
      playerStats: {
        providerAvailable: true,
        rawRows: 27,
        normalizedRows: 27,
        resolvedPlayers: 25,
        unresolvedPlayers: 2,
        databaseRows: 0,
        diagnosis: 'PROVIDER_HAS_PLAYER_STATS_DB_MISSING',
        explanation: 'ok',
      },
      plays: {
        providerAvailable: true,
        rawCount: 184,
        normalizedCount: 184,
        databaseActiveCount: 184,
        diagnosis: 'PLAYS_COMPLETE',
        explanation: 'ok',
      },
    }),
  };
}

function app(dataHealthService: DataHealthServiceContract) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer admin')
      req.auth = { userId: adminUserId, sessionId: '00000000-0000-4000-8000-000000000003' };
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId: editorUserId, sessionId: '00000000-0000-4000-8000-000000000004' };
    next();
  };
  const router = createDataHealthRouter({
    authenticate,
    identities: {
      findAdministrativeIdentity: (id) => {
        if (id === adminUserId) {
          return Promise.resolve({
            userId: adminUserId,
            email: 'admin@example.com',
            role: 'ADMIN',
          });
        }
        if (id === editorUserId) {
          return Promise.resolve({
            userId: editorUserId,
            email: 'editor@example.com',
            role: 'EDITOR',
          });
        }
        return Promise.resolve(null);
      },
    },
    service: dataHealthService,
  });
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin/data-health', router);
  instance.use(errorHandler);
  return instance;
}

describe('data-health routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app(service())).get('/api/v1/admin/data-health/games');
    expect(response.status).toBe(401);
  });

  it('allows an EDITOR to view the overview', async () => {
    const response = await request(app(service()))
      .get('/api/v1/admin/data-health/games')
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('summary');
  });

  it('allows an EDITOR to view a game detail', async () => {
    const response = await request(app(service()))
      .get(`/api/v1/admin/data-health/games/${gameId}`)
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
  });

  it('forbids an EDITOR from running a provider probe', async () => {
    const response = await request(app(service()))
      .post(`/api/v1/admin/data-health/games/${gameId}/probe`)
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(403);
  });

  it('allows an ADMIN to run a provider probe', async () => {
    const svc = service();
    const response = await request(app(svc))
      .post(`/api/v1/admin/data-health/games/${gameId}/probe`)
      .set('Authorization', 'Bearer admin');
    expect(response.status).toBe(200);
    expect(vi.mocked(svc.runProbe)).toHaveBeenCalledWith(gameId);
  });

  it('never leaks provider record identifiers or raw payload keys in probe responses', async () => {
    const response = await request(app(service()))
      .post(`/api/v1/admin/data-health/games/${gameId}/probe`)
      .set('Authorization', 'Bearer admin');
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('providerGameId');
    expect(raw).not.toContain('providerPlayerId');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('matchStatistics');
  });
});
