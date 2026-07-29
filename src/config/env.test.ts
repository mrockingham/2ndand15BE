import { describe, expect, it } from 'vitest';

import { EnvironmentValidationError, loadConfig } from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-characters',
};

describe('loadConfig', () => {
  it('loads validated defaults', () => {
    const config = loadConfig(requiredEnvironment);

    expect(config).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      databaseUrl: requiredEnvironment.DATABASE_URL,
      corsOrigins: ['http://localhost:5173'],
      logLevel: 'info',
      rateLimit: {
        windowMs: 60_000,
        max: 100,
      },
      auth: {
        accessTokenSecret: requiredEnvironment.JWT_ACCESS_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 2_592_000,
        cookie: {
          name: 'secondand15_refresh',
          secure: false,
          sameSite: 'lax',
          path: '/api/v1/auth',
        },
        rateLimit: {
          windowMs: 900_000,
          max: 10,
        },
      },
      passwordReset: {
        tokenTtlSeconds: 1_800,
        frontendUrl: 'http://localhost:5173/reset-password',
        rateLimit: {
          windowMs: 900_000,
          max: 5,
        },
      },
      email: {
        provider: 'development',
        logResetUrl: false,
      },
    });
  });

  it('parses a comma-separated CORS allowlist', () => {
    const config = loadConfig({
      ...requiredEnvironment,
      CORS_ORIGINS: 'https://app.example.com, https://preview.example.com',
    });

    expect(config.corsOrigins).toEqual(['https://app.example.com', 'https://preview.example.com']);
  });

  it('rejects wildcard CORS with credentialed requests', () => {
    expect(() => loadConfig({ ...requiredEnvironment, CORS_ORIGINS: '*' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('parses configurable authentication lifetimes and secure cookie settings', () => {
    const config = loadConfig({
      ...requiredEnvironment,
      ACCESS_TOKEN_TTL: '10m',
      REFRESH_TOKEN_TTL: '14d',
      REFRESH_COOKIE_SECURE: 'true',
      REFRESH_COOKIE_SAME_SITE: 'none',
      PASSWORD_RESET_TOKEN_TTL: '45m',
    });

    expect(config.auth.accessTokenTtlSeconds).toBe(600);
    expect(config.auth.refreshTokenTtlSeconds).toBe(1_209_600);
    expect(config.auth.cookie).toMatchObject({ secure: true, sameSite: 'none' });
    expect(config.passwordReset.tokenTtlSeconds).toBe(2_700);
  });

  it('rejects insecure production cookie and reset URL settings', () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        REFRESH_COOKIE_SECURE: 'false',
        PASSWORD_RESET_FRONTEND_URL: 'http://example.com/reset-password',
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it('rejects a non-PostgreSQL database URL without including its value in the error', () => {
    const secretUrl = 'mysql://user:secret@localhost/database';
    let thrownError: unknown;

    try {
      loadConfig({ ...requiredEnvironment, DATABASE_URL: secretUrl });
    } catch (error: unknown) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(EnvironmentValidationError);
    expect((thrownError as EnvironmentValidationError).message).not.toContain(secretUrl);
  });
});
