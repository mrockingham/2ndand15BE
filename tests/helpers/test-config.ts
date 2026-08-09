import type { AppConfig } from '../../src/config/env.js';
import { AppError } from '../../src/common/errors/app-error.js';
import type { AccessTokenService } from '../../src/common/security/access-token.js';
import type {
  AuthenticationResult,
  AuthenticationService,
} from '../../src/modules/auth/auth.service.js';
import type { TeamReader } from '../../src/modules/teams/team.service.js';
import type { GameReader } from '../../src/modules/games/game.service.js';
import type { UserPersonalizationService } from '../../src/modules/users/user.service.js';

export function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: 'postgresql://test:test@localhost:5432/test?schema=public',
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    rateLimit: {
      windowMs: 60_000,
      max: 100,
    },
    auth: {
      accessTokenSecret: 'test-access-secret-that-is-at-least-32-characters',
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
    editorialAi: {
      provider: 'none',
      apiKey: null,
      model: null,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30_000,
    },
    sports: {
      provider: 'mock',
      currentNflSeason: 2026,
      allowHistoricalDefaultGameResults: false,
      fixtureDataEnabled: true,
      apiSports: {
        baseUrl: 'https://v1.american-football.api-sports.io',
        apiKey: null,
        requestTimeoutMs: 10_000,
        maxRetries: 2,
        syncSeason: 2026,
        syncSeasonType: null,
        storeLogoUrls: false,
      },
    },
    ...overrides,
  };
}

export function createTestTeamReader(overrides: Partial<TeamReader> = {}): TeamReader {
  return {
    listActiveTeams: () => Promise.resolve([]),
    getActiveTeam: () =>
      Promise.reject(
        new AppError({
          code: 'TEAM_NOT_FOUND',
          message: 'The requested active team was not found.',
          statusCode: 404,
        }),
      ),
    ...overrides,
  };
}

export function createTestGameReader(overrides: Partial<GameReader> = {}): GameReader {
  return {
    listGames: () => Promise.resolve({ games: [], nextCursor: null }),
    listTeamGames: () => Promise.resolve({ games: [], nextCursor: null }),
    getGame: () =>
      Promise.reject(
        new AppError({
          code: 'GAME_NOT_FOUND',
          message: 'The requested game was not found.',
          statusCode: 404,
        }),
      ),
    ...overrides,
  };
}

const unavailableAuthenticationResult = (): Promise<AuthenticationResult> =>
  Promise.reject(new Error('Authentication behavior was not configured for this test.'));

export function createTestAuthService(
  overrides: Partial<AuthenticationService> = {},
): AuthenticationService {
  return {
    register: unavailableAuthenticationResult,
    login: unavailableAuthenticationResult,
    refresh: unavailableAuthenticationResult,
    logout: () => Promise.resolve(),
    getCurrentUser: () =>
      Promise.reject(
        new AppError({
          code: 'UNAUTHORIZED',
          message: 'A valid access token is required.',
          statusCode: 401,
        }),
      ),
    forgotPassword: () => Promise.resolve(),
    resetPassword: () => Promise.resolve(),
    ...overrides,
  };
}

export function createTestUserService(
  overrides: Partial<UserPersonalizationService> = {},
): UserPersonalizationService {
  return {
    updateFavoriteTeam: () =>
      Promise.reject(new Error('User personalization behavior was not configured for this test.')),
    ...overrides,
  };
}

export function createTestAccessTokenService(
  overrides: Partial<AccessTokenService> = {},
): AccessTokenService {
  return {
    expiresInSeconds: 900,
    sign: () => Promise.resolve('test-access-token'),
    verify: () =>
      Promise.resolve({
        userId: '00000000-0000-4000-8000-000000000010',
        sessionId: '00000000-0000-4000-8000-000000000011',
      }),
    ...overrides,
  };
}
