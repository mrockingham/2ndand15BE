import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../app.js';
import { CryptoOpaqueTokenService } from '../../common/security/opaque-token.js';
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
import { InMemoryEmailService } from '../email/in-memory-email.service.js';
import { createTeamRecord } from '../teams/team.test-fixtures.js';
import { UserService } from '../users/user.service.js';
import { AuthService } from './auth.service.js';

const authResponseSchema = z
  .object({
    data: z
      .object({
        user: z
          .object({
            id: z.uuid(),
            email: z.email(),
            displayName: z.string().nullable(),
            isActive: z.boolean(),
            favoriteTeam: z
              .object({
                id: z.uuid(),
                league: z.literal('NFL'),
                city: z.string(),
                name: z.string(),
                fullName: z.string(),
                abbreviation: z.string(),
                conference: z.enum(['AFC', 'NFC']),
                division: z.enum(['East', 'North', 'South', 'West']),
                primaryColor: z.string(),
                secondaryColor: z.string(),
                logoUrl: z.string().nullable(),
                logoSource: z.string().nullable(),
                isActive: z.boolean(),
                createdAt: z.iso.datetime(),
                updatedAt: z.iso.datetime(),
              })
              .strict()
              .nullable(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
          })
          .strict(),
        accessToken: z.string().min(1),
        accessTokenExpiresIn: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const metadata = { userAgent: 'test-agent', ipAddress: '127.0.0.1' } as const;

function createHarness(config = createTestConfig()) {
  const repository = new InMemoryAuthRepository();
  const emailService = new InMemoryEmailService();
  const accessTokens = new TestAccessTokenService();
  const authService = new AuthService({
    repository,
    passwordHasher: new TestPasswordHasher(),
    accessTokens,
    opaqueTokens: new CryptoOpaqueTokenService(),
    emailService,
    refreshTokenTtlSeconds: config.auth.refreshTokenTtlSeconds,
    passwordResetTokenTtlSeconds: config.passwordReset.tokenTtlSeconds,
    passwordResetFrontendUrl: config.passwordReset.frontendUrl,
    now: () => new Date('2026-07-28T12:00:00.000Z'),
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
  return { app, authService, userService, repository, emailService };
}

describe('authentication routes', () => {
  it('registers, returns no secrets, and creates the constrained refresh cookie', async () => {
    const { app, repository } = createHarness();

    const response = await request(app).post('/api/v1/auth/register').send({
      email: 'User@Example.com',
      password: 'a secure password',
      displayName: 'Michael',
    });

    expect(response.status).toBe(201);
    const body = authResponseSchema.parse(response.body);
    expect(body.data.user).toMatchObject({ email: 'User@Example.com', displayName: 'Michael' });
    expect(body.data.user.favoriteTeam).toBeNull();
    expect(repository.users[0]?.passwordHash).not.toContain('a secure password');
    const setCookie = getFirstSetCookie(response.headers['set-cookie']);
    expect(setCookie).toContain('secondand15_refresh=');
    expect(setCookie).toContain('Path=/api/v1/auth');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');
  });

  it('returns a conflict for duplicate email casing and generic login failures', async () => {
    const { app } = createHarness();
    await request(app).post('/api/v1/auth/register').send({
      email: 'user@example.com',
      password: 'a secure password',
    });

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'USER@example.com', password: 'another secure password' })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ error: { code: 'EMAIL_ALREADY_REGISTERED' } });
      });

    for (const credentials of [
      { email: 'user@example.com', password: 'wrong password value' },
      { email: 'unknown@example.com', password: 'wrong password value' },
    ]) {
      await request(app)
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(401)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          });
        });
    }
  });

  it('logs in successfully and never includes the refresh token in JSON', async () => {
    const { app, repository, userService } = createHarness();
    const registration = await request(app).post('/api/v1/auth/register').send({
      email: 'user@example.com',
      password: 'a secure password',
    });
    const registeredBody = authResponseSchema.parse(registration.body);
    const team = createTeamRecord();
    repository.teams.push(team);
    await userService.updateFavoriteTeam(registeredBody.data.user.id, team.id);

    const response = await request(app).post('/api/v1/auth/login').send({
      email: 'USER@example.com',
      password: 'a secure password',
    });

    expect(response.status).toBe(200);
    const body = authResponseSchema.parse(response.body);
    expect(body.data.user.favoriteTeam).toMatchObject({ id: team.id, abbreviation: 'BUF' });
    expect(getFirstSetCookie(response.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('protects /users/me and returns the authenticated user', async () => {
    const { app, authService } = createHarness();
    const registration = await authService.register({
      email: 'user@example.com',
      password: 'a secure password',
      metadata,
    });

    await request(app).get('/api/v1/users/me').expect(401);
    await request(app)
      .get('/api/v1/users/me')
      .set('authorization', 'Bearer invalid-token')
      .expect(401);

    const response = await request(app)
      .get('/api/v1/users/me')
      .set('authorization', `Bearer ${registration.accessToken}`)
      .expect(200);
    expect(response.body).toEqual({ data: { user: registration.user } });
  });

  it('rotates refresh cookies and rejects reuse of the previous token', async () => {
    const { app, repository, userService } = createHarness();
    const registration = await request(app).post('/api/v1/auth/register').send({
      email: 'user@example.com',
      password: 'a secure password',
    });
    const registeredBody = authResponseSchema.parse(registration.body);
    const team = createTeamRecord();
    repository.teams.push(team);
    await userService.updateFavoriteTeam(registeredBody.data.user.id, team.id);
    const originalCookie = getCookiePair(getFirstSetCookie(registration.headers['set-cookie']));

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('cookie', originalCookie)
      .expect(200);
    const refreshedBody = authResponseSchema.parse(refresh.body);
    expect(refreshedBody.data.user.favoriteTeam).toMatchObject({ id: team.id });
    const replacementCookie = getCookiePair(getFirstSetCookie(refresh.headers['set-cookie']));
    expect(replacementCookie).not.toBe(originalCookie);

    await request(app).post('/api/v1/auth/refresh').set('cookie', originalCookie).expect(401);
  });

  it('logs out idempotently, revokes the session, and clears the cookie', async () => {
    const { app, repository } = createHarness();
    const registration = await request(app).post('/api/v1/auth/register').send({
      email: 'user@example.com',
      password: 'a secure password',
    });
    const cookie = getCookiePair(getFirstSetCookie(registration.headers['set-cookie']));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('cookie', cookie)
        .expect(204);
      const clearedCookie = getFirstSetCookie(response.headers['set-cookie']);
      expect(clearedCookie).toContain('secondand15_refresh=;');
      expect(clearedCookie).toContain('Path=/api/v1/auth');
    }
    expect(repository.sessions[0]?.revokedAt).not.toBeNull();
  });

  it('returns the same forgot-password response and captures only a known-user email', async () => {
    const { app, authService, emailService } = createHarness();
    await authService.register({
      email: 'User@Example.com',
      password: 'a secure password',
      metadata,
    });

    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'USER@example.com' })
      .expect(200);
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(200);

    expect(known.body).toEqual(unknown.body);
    expect(emailService.passwordResetMessages).toHaveLength(1);
  });

  it('resets the password without logging in and clears a refresh cookie', async () => {
    const { app, authService, emailService } = createHarness();
    const registration = await authService.register({
      email: 'user@example.com',
      password: 'old secure password',
      metadata,
    });
    await authService.forgotPassword({ email: 'user@example.com', metadata });
    const resetUrl = new URL(emailService.passwordResetMessages[0]?.resetUrl ?? '');

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .set('cookie', `secondand15_refresh=${registration.refreshToken}`)
      .send({ token: resetUrl.searchParams.get('token'), password: 'new secure password' })
      .expect(200);

    expect(getFirstSetCookie(response.headers['set-cookie'])).toContain('secondand15_refresh=;');
    await expect(
      authService.login({
        email: 'user@example.com',
        password: 'new secure password',
        metadata,
      }),
    ).resolves.toBeDefined();
  });

  it('applies the strict forgot-password rate limit', async () => {
    const baseConfig = createTestConfig();
    const config = {
      ...baseConfig,
      passwordReset: {
        ...baseConfig.passwordReset,
        rateLimit: { windowMs: 60_000, max: 1 },
      },
    };
    const { app } = createHarness(config);

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'one@example.com' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'two@example.com' })
      .expect(429);
  });
});

function getFirstSetCookie(header: unknown): string {
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('Expected a Set-Cookie response header.');
  }
  return header[0];
}

function getCookiePair(setCookie: string): string {
  const pair = setCookie.split(';', 1)[0];
  if (pair === undefined) {
    throw new Error('Expected a cookie name/value pair.');
  }
  return pair;
}
