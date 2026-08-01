import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestGameReader,
  createTestTeamReader,
  createTestUserService,
} from '../../../tests/helpers/test-config.js';

describe('GET /api/v1/health', () => {
  it('returns the process health in the success envelope', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: pino({ level: 'silent' }),
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
      health: {
        now: () => new Date('2026-07-28T12:00:00.000Z'),
        uptime: () => 42,
      },
    });

    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        timestamp: '2026-07-28T12:00:00.000Z',
        uptimeSeconds: 42,
      },
    });
  });

  it('preserves a safe caller-supplied request ID', async () => {
    const app = createApp({
      config: createTestConfig(),
      logger: pino({ level: 'silent' }),
      teamReader: createTestTeamReader(),
      gameReader: createTestGameReader(),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens: createTestAccessTokenService(),
    });

    const response = await request(app)
      .get('/api/v1/health')
      .set('x-request-id', 'frontend-request-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('frontend-request-123');
  });
});
