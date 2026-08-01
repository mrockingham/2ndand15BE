import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createTestConfig,
  createTestGameReader,
  createTestTeamReader,
} from '../../../tests/helpers/test-config.js';
import { InMemoryAuthRepository } from '../../../tests/helpers/in-memory-auth-repository.js';
import {
  TestAccessTokenService,
  TestPasswordHasher,
} from '../../../tests/helpers/test-auth-services.js';
import { createApp } from '../../app.js';
import { CryptoOpaqueTokenService } from '../../common/security/opaque-token.js';
import { AuthService } from '../auth/auth.service.js';
import { InMemoryEmailService } from '../email/in-memory-email.service.js';
import { createTeamRecord } from '../teams/team.test-fixtures.js';
import { UserService } from './user.service.js';

const favoriteTeamSchema = z.looseObject({ id: z.uuid(), abbreviation: z.string() });
const userResponseSchema = z.looseObject({
  data: z.object({
    user: z.looseObject({ favoriteTeam: favoriteTeamSchema.nullable() }),
  }),
});
const errorResponseSchema = z.looseObject({
  error: z.looseObject({ code: z.string() }),
});

function createHarness() {
  const config = createTestConfig();
  const repository = new InMemoryAuthRepository();
  const accessTokens = new TestAccessTokenService();
  const authService = new AuthService({
    repository,
    passwordHasher: new TestPasswordHasher(),
    accessTokens,
    opaqueTokens: new CryptoOpaqueTokenService(),
    emailService: new InMemoryEmailService(),
    refreshTokenTtlSeconds: config.auth.refreshTokenTtlSeconds,
    passwordResetTokenTtlSeconds: config.passwordReset.tokenTtlSeconds,
    passwordResetFrontendUrl: config.passwordReset.frontendUrl,
  });
  const userService = new UserService(repository);
  const app = createApp({
    config,
    logger: pino({ level: 'silent' }),
    teamReader: createTestTeamReader(),
    gameReader: createTestGameReader(),
    authService,
    userService,
    accessTokens,
  });
  return { app, authService, repository };
}

async function register(authService: AuthService) {
  return authService.register({
    email: 'user@example.com',
    password: 'a secure password',
    metadata: { userAgent: 'test-agent', ipAddress: '127.0.0.1' },
  });
}

describe('user personalization routes', () => {
  it('returns null initially, then sets and replaces a normalized favorite team', async () => {
    const { app, authService, repository } = createHarness();
    const registration = await register(authService);
    const bills = createTeamRecord();
    const ravens = createTeamRecord({
      id: randomUUID(),
      city: 'Baltimore',
      name: 'Ravens',
      fullName: 'Baltimore Ravens',
      abbreviation: 'BAL',
      division: 'North',
      primaryColor: '#241773',
      secondaryColor: '#000000',
    });
    repository.teams.push(bills, ravens);
    const authorization = `Bearer ${registration.accessToken}`;

    const initial = await request(app)
      .get('/api/v1/users/me')
      .set('authorization', authorization)
      .expect(200);
    const initialBody = userResponseSchema.parse(initial.body);
    expect(initialBody.data.user.favoriteTeam).toBeNull();

    const selected = await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', authorization)
      .send({ favoriteTeamId: bills.id })
      .expect(200);
    const selectedBody = userResponseSchema.parse(selected.body);
    expect(selectedBody.data.user.favoriteTeam).toMatchObject({
      id: bills.id,
      abbreviation: 'BUF',
    });
    expect(selectedBody.data.user).not.toHaveProperty('passwordHash');
    expect(selectedBody.data.user).not.toHaveProperty('sessions');
    expect(selectedBody.data.user.favoriteTeam).not.toHaveProperty('providerMaps');

    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', authorization)
      .send({ favoriteTeamId: ravens.id })
      .expect(200)
      .expect(({ body }) => {
        const parsed = userResponseSchema.parse(body);
        expect(parsed.data.user.favoriteTeam).toMatchObject({
          id: ravens.id,
          abbreviation: 'BAL',
        });
      });

    await request(app)
      .get('/api/v1/users/me')
      .set('authorization', authorization)
      .expect(200)
      .expect(({ body }) => {
        const parsed = userResponseSchema.parse(body);
        expect(parsed.data.user.favoriteTeam).toMatchObject({ id: ravens.id });
      });
  });

  it('clears a favorite team idempotently with null', async () => {
    const { app, authService, repository } = createHarness();
    const registration = await register(authService);
    const team = createTeamRecord();
    repository.teams.push(team);
    const authorization = `Bearer ${registration.accessToken}`;

    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', authorization)
      .send({ favoriteTeamId: team.id })
      .expect(200);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app)
        .patch('/api/v1/users/me/favorite-team')
        .set('authorization', authorization)
        .send({ favoriteTeamId: null })
        .expect(200)
        .expect(({ body }) => {
          const parsed = userResponseSchema.parse(body);
          expect(parsed.data.user.favoriteTeam).toBeNull();
        });
    }
  });

  it('validates UUIDs and requires the favoriteTeamId property', async () => {
    const { app, authService } = createHarness();
    const registration = await register(authService);
    const authorization = `Bearer ${registration.accessToken}`;

    for (const body of [{ favoriteTeamId: 'not-a-uuid' }, {}]) {
      await request(app)
        .patch('/api/v1/users/me/favorite-team')
        .set('authorization', authorization)
        .send(body)
        .expect(400)
        .expect(({ body: responseBody }) => {
          expect(responseBody).toMatchObject({
            error: { code: 'VALIDATION_ERROR', details: [{ field: 'favoriteTeamId' }] },
          });
        });
    }
  });

  it('rejects unknown and inactive teams', async () => {
    const { app, authService, repository } = createHarness();
    const registration = await register(authService);
    const inactiveTeam = createTeamRecord({ isActive: false });
    repository.teams.push(inactiveTeam);
    const authorization = `Bearer ${registration.accessToken}`;

    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', authorization)
      .send({ favoriteTeamId: randomUUID() })
      .expect(404)
      .expect(({ body }) => {
        expect(errorResponseSchema.parse(body).error.code).toBe('TEAM_NOT_FOUND');
      });
    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', authorization)
      .send({ favoriteTeamId: inactiveTeam.id })
      .expect(409)
      .expect(({ body }) => {
        expect(errorResponseSchema.parse(body).error.code).toBe('TEAM_INACTIVE');
      });
  });

  it('requires authentication and rejects an inactive user', async () => {
    const { app, authService, repository } = createHarness();

    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .send({ favoriteTeamId: null })
      .expect(401);

    const registration = await register(authService);
    const user = repository.users[0];
    if (user === undefined) {
      throw new Error('Expected a registered test user.');
    }
    user.isActive = false;
    await request(app)
      .patch('/api/v1/users/me/favorite-team')
      .set('authorization', `Bearer ${registration.accessToken}`)
      .send({ favoriteTeamId: null })
      .expect(401);
  });
});
