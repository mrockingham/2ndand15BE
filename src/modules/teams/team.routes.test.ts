import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  createTestAccessTokenService,
  createTestAuthService,
  createTestConfig,
  createTestUserService,
} from '../../../tests/helpers/test-config.js';
import { createApp } from '../../app.js';
import { TeamService } from './team.service.js';
import { createTeamRecord } from './team.test-fixtures.js';
import type { TeamRepository } from './team.repository.js';

function createRepository(overrides: Partial<TeamRepository> = {}): TeamRepository {
  return {
    findActiveTeams: () => Promise.resolve([]),
    findActiveTeamById: () => Promise.resolve(null),
    ...overrides,
  };
}

function createTeamApp(repository: TeamRepository) {
  return createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    teamReader: new TeamService(repository),
    authService: createTestAuthService(),
    userService: createTestUserService(),
    accessTokens: createTestAccessTokenService(),
  });
}

describe('team routes', () => {
  it('GET /api/v1/teams returns normalized active teams', async () => {
    const team = createTeamRecord();
    const app = createTeamApp(createRepository({ findActiveTeams: () => Promise.resolve([team]) }));

    const response = await request(app).get('/api/v1/teams').expect(200);

    expect(response.body).toEqual({
      data: [
        {
          id: team.id,
          league: 'NFL',
          city: 'Buffalo',
          name: 'Bills',
          fullName: 'Buffalo Bills',
          abbreviation: 'BUF',
          conference: 'AFC',
          division: 'East',
          primaryColor: '#00338D',
          secondaryColor: '#C60C30',
          logoUrl: null,
          logoSource: null,
          isActive: true,
          createdAt: '2026-07-28T12:00:00.000Z',
          updatedAt: '2026-07-28T12:00:00.000Z',
        },
      ],
    });
  });

  it('GET /api/v1/teams/:teamId returns one team without provider mappings', async () => {
    const team = createTeamRecord();
    const app = createTeamApp(
      createRepository({ findActiveTeamById: () => Promise.resolve(team) }),
    );

    const response = await request(app).get(`/api/v1/teams/${team.id}`).expect(200);

    expect(response.body).toEqual({
      data: {
        id: team.id,
        league: 'NFL',
        city: 'Buffalo',
        name: 'Bills',
        fullName: 'Buffalo Bills',
        abbreviation: 'BUF',
        conference: 'AFC',
        division: 'East',
        primaryColor: '#00338D',
        secondaryColor: '#C60C30',
        logoUrl: null,
        logoSource: null,
        isActive: true,
        createdAt: '2026-07-28T12:00:00.000Z',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
    });
  });

  it('rejects an invalid team ID with validation details', async () => {
    const app = createTeamApp(createRepository());

    const response = await request(app).get('/api/v1/teams/not-a-uuid').expect(400);

    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request parameters are invalid.',
        details: [{ field: 'teamId' }],
      },
    });
  });

  it('returns the standard not-found envelope for an absent or inactive team', async () => {
    const app = createTeamApp(createRepository());

    const response = await request(app)
      .get('/api/v1/teams/00000000-0000-4000-8000-000000000099')
      .expect(404);

    expect(response.body).toMatchObject({
      error: {
        code: 'TEAM_NOT_FOUND',
        message: 'The requested active team was not found.',
      },
    });
  });
});
