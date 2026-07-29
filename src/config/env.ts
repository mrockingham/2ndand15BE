import { z } from 'zod';

const postgresUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'postgres:' || protocol === 'postgresql:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid PostgreSQL connection URL' },
  );

const corsOriginsSchema = z
  .string()
  .default('http://localhost:5173')
  .transform((value, context) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.includes('*')) {
      context.addIssue({
        code: 'custom',
        message: 'Wildcard origins are not allowed with credentialed requests',
      });
      return z.NEVER;
    }

    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Invalid origin');
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: `Invalid CORS origin: ${origin}`,
        });
        return z.NEVER;
      }
    }

    return origins;
  });

const durationSchema = (defaultValue: string) =>
  z
    .string()
    .regex(/^\d+[smhd]$/, 'Must use a duration such as 15m, 12h, or 30d')
    .default(defaultValue)
    .transform(parseDurationSeconds)
    .pipe(z.number().int().positive().max(31_536_000));

const booleanSchema = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: postgresUrlSchema,
  CORS_ORIGINS: corsOriginsSchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
});

const environmentSchema = baseEnvironmentSchema
  .extend({
    JWT_ACCESS_SECRET: z.string().min(32).max(1024),
    ACCESS_TOKEN_TTL: durationSchema('15m'),
    REFRESH_TOKEN_TTL: durationSchema('30d'),
    REFRESH_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .default('secondand15_refresh'),
    REFRESH_COOKIE_SECURE: booleanSchema(false),
    REFRESH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    PASSWORD_RESET_TOKEN_TTL: durationSchema('30m'),
    PASSWORD_RESET_FRONTEND_URL: z.url().default('http://localhost:5173/reset-password'),
    EMAIL_PROVIDER: z.enum(['development']).default('development'),
    EMAIL_DEV_LOG_RESET_URL: booleanSchema(false),
  })
  .superRefine((value, context) => {
    if (value.REFRESH_COOKIE_SAME_SITE === 'none' && !value.REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['REFRESH_COOKIE_SECURE'],
        message: 'Must be true when REFRESH_COOKIE_SAME_SITE is none',
      });
    }

    if (value.NODE_ENV === 'production') {
      if (!value.REFRESH_COOKIE_SECURE) {
        context.addIssue({
          code: 'custom',
          path: ['REFRESH_COOKIE_SECURE'],
          message: 'Must be true in production',
        });
      }
      if (!value.PASSWORD_RESET_FRONTEND_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['PASSWORD_RESET_FRONTEND_URL'],
          message: 'Must use HTTPS in production',
        });
      }
      if (value.EMAIL_DEV_LOG_RESET_URL) {
        context.addIssue({
          code: 'custom',
          path: ['EMAIL_DEV_LOG_RESET_URL'],
          message: 'Must be false in production',
        });
      }
    }
  });

export interface DatabaseConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrl: string;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export interface AppConfig extends DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly rateLimit: RateLimitConfig;
  readonly auth: {
    readonly accessTokenSecret: string;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlSeconds: number;
    readonly cookie: {
      readonly name: string;
      readonly secure: boolean;
      readonly sameSite: 'lax' | 'strict' | 'none';
      readonly path: '/api/v1/auth';
    };
    readonly rateLimit: RateLimitConfig;
  };
  readonly passwordReset: {
    readonly tokenTtlSeconds: number;
    readonly frontendUrl: string;
    readonly rateLimit: RateLimitConfig;
  };
  readonly email: {
    readonly provider: 'development';
    readonly logResetUrl: boolean;
  };
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

export class EnvironmentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}

export function loadDatabaseConfig(
  environment: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const data = parseEnvironment(baseEnvironmentSchema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
  };
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const data = parseEnvironment(environmentSchema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    corsOrigins: data.CORS_ORIGINS,
    logLevel: data.LOG_LEVEL,
    rateLimit: {
      windowMs: data.RATE_LIMIT_WINDOW_MS,
      max: data.RATE_LIMIT_MAX,
    },
    auth: {
      accessTokenSecret: data.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: data.ACCESS_TOKEN_TTL,
      refreshTokenTtlSeconds: data.REFRESH_TOKEN_TTL,
      cookie: {
        name: data.REFRESH_COOKIE_NAME,
        secure: data.REFRESH_COOKIE_SECURE,
        sameSite: data.REFRESH_COOKIE_SAME_SITE,
        path: '/api/v1/auth',
      },
      rateLimit: {
        windowMs: data.AUTH_RATE_LIMIT_WINDOW_MS,
        max: data.AUTH_RATE_LIMIT_MAX,
      },
    },
    passwordReset: {
      tokenTtlSeconds: data.PASSWORD_RESET_TOKEN_TTL,
      frontendUrl: data.PASSWORD_RESET_FRONTEND_URL,
      rateLimit: {
        windowMs: data.AUTH_RATE_LIMIT_WINDOW_MS,
        max: data.PASSWORD_RESET_RATE_LIMIT_MAX,
      },
    },
    email: {
      provider: data.EMAIL_PROVIDER,
      logResetUrl: data.EMAIL_DEV_LOG_RESET_URL,
    },
  };
}

function parseEnvironment<T extends z.ZodType>(
  schema: T,
  environment: Record<string, string | undefined>,
): z.output<T> {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.join('.') || 'environment';
      return `${field}: ${issue.message}`;
    });
    throw new EnvironmentValidationError(issues);
  }

  return result.data;
}

function parseDurationSeconds(value: string): number {
  const amount = Number.parseInt(value.slice(0, -1), 10);
  const unit = value.at(-1);
  const multipliers: Readonly<Record<string, number>> = {
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
  };
  return amount * (unit === undefined ? 0 : (multipliers[unit] ?? 0));
}
