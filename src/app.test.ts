import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestGameReader,
  createTestTeamReader,
  createTestUserService,
} from '../tests/helpers/test-config.js';
import { createApp } from './app.js';

const silentLogger = pino({ level: 'silent' });

describe('application middleware', () => {
  it('returns the consistent error envelope for an unknown route', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app).get('/api/v1/not-a-route').expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route GET /api/v1/not-a-route was not found.',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('allows configured credentialed CORS origins', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app)
      .get('/api/v1/health')
      .set('origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('returns the rate-limit error envelope when the configured limit is exceeded', async () => {
    const app = createApp({
      config: createTestConfig({ rateLimit: { windowMs: 60_000, max: 1 } }),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    await request(app).get('/api/v1/health').expect(200);
    const response = await request(app).get('/api/v1/health').expect(429);

    expect(response.body).toEqual({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('maps malformed JSON to a safe client error', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app)
      .post('/api/v1/not-a-route')
      .set('content-type', 'application/json')
      .send('{')
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'The request body contains invalid JSON.',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('serves the OpenAPI document', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app).get('/api/v1/docs/openapi.json').expect(200);

    expect(response.body).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/health': {
          get: { operationId: 'getHealth' },
        },
        '/teams': {
          get: { operationId: 'listTeams' },
        },
        '/teams/{teamId}': {
          get: { operationId: 'getTeamById' },
        },
        '/games': {
          get: { operationId: 'listGames' },
        },
        '/games/{gameId}': {
          get: { operationId: 'getGameById' },
        },
        '/teams/{teamId}/games': {
          get: { operationId: 'listTeamGames' },
        },
        '/auth/register': {
          post: { operationId: 'register' },
        },
        '/auth/forgot-password': {
          post: { operationId: 'forgotPassword' },
        },
        '/users/me': {
          get: { operationId: 'getCurrentUser' },
        },
        '/users/me/favorite-team': {
          patch: { operationId: 'updateFavoriteTeam' },
        },
      },
    });
  });

  it('serves the interactive API documentation with a route-specific CSP', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: silentLogger,
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app).get('/api/v1/docs/').expect(200);

    expect(response.text).toContain('Swagger UI');
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
  });
});
