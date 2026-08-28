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
import type { StandingsReader, StandingsResult } from './standings.service.js';
import { AppError } from '../../common/errors/app-error.js';

const result: StandingsResult = {
  data: { season: 2026, seasonType: 'PRE', view: 'division', groups: [] },
  meta: {
    availableViews: ['division', 'conference', 'league'],
    availableSeasonTypes: ['PRE', 'REG'],
    provider: 'highlightly',
    updatedAt: '2026-08-28T12:00:00.000Z',
  },
};

describe('standings routes', () => {
  it('returns the grouped public standings response', async () => {
    const app = createStandingsApp({ getStandings: () => Promise.resolve(result) });
    const response = await request(app)
      .get('/api/v1/standings?season=2026&seasonType=PRE')
      .expect(200);
    expect(response.body).toEqual(result);
  });

  it('rejects invalid query parameters', async () => {
    const app = createStandingsApp({ getStandings: () => Promise.resolve(result) });
    const response = await request(app)
      .get('/api/v1/standings?season=2026&seasonType=ALL')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns the standard not-found error when no snapshot exists', async () => {
    const app = createStandingsApp({
      getStandings: () =>
        Promise.reject(
          new AppError({
            code: 'STANDINGS_NOT_FOUND',
            message: 'Standings are not available for the requested season and season type.',
            statusCode: 404,
          }),
        ),
    });
    const response = await request(app)
      .get('/api/v1/standings?season=2026&seasonType=REG')
      .expect(404);
    const body = response.body as { error: { code: string } };
    expect(body.error).toMatchObject({ code: 'STANDINGS_NOT_FOUND' });
  });
});

function createStandingsApp(standingsReader: StandingsReader) {
  return createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader: createTestGameReader(),
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
    standingsReader,
  });
}
