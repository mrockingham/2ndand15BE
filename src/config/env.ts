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

const optionalSecretSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).max(1024).optional(),
);

const optionalSeasonSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(1920).max(2100).optional(),
);

const highlightlyEvaluationEnvironmentSchema = z
  .object({
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    HIGHLIGHTLY_API_KEY: z.string().min(1).max(1024),
    HIGHLIGHTLY_BASE_URL: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'Must use HTTPS')
      .default('https://american-football.highlightly.net'),
    HIGHLIGHTLY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    HIGHLIGHTLY_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
    HIGHLIGHTLY_EVALUATION_SEASON: optionalSeasonSchema,
    CURRENT_NFL_SEASON: optionalSeasonSchema,
  })
  .superRefine((value, context) => {
    if (
      value.HIGHLIGHTLY_EVALUATION_SEASON === undefined &&
      value.CURRENT_NFL_SEASON === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['HIGHLIGHTLY_EVALUATION_SEASON'],
        message: 'Is required when CURRENT_NFL_SEASON is not configured',
      });
    }
  });

const databaseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrlSchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const newsIngestionPolicyFields = {
  // M30D: bounds applied only to a source's first-ever completed ingest -- see
  // src/modules/news-inbox/initial-ingest-policy.ts and
  // docs/news/official-team-source-activation.md.
  NEWS_INITIAL_INGEST_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE: z.coerce.number().int().min(1).max(200).default(25),
  NEWS_LATE_ITEM_TOLERANCE_HOURS: z.coerce.number().int().min(1).max(168).default(48),
} as const;

const newsIngestionEnvironmentSchema = databaseEnvironmentSchema.extend(newsIngestionPolicyFields);

const currentGameEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    CURRENT_GAME_PROVIDER: z.enum(['highlightly']),
    HIGHLIGHTLY_EVALUATION_MODE: booleanSchema(false),
    HIGHLIGHTLY_PUBLICATION_APPROVED: booleanSchema(false),
    HIGHLIGHTLY_API_KEY: z.string().min(1).max(1024),
    HIGHLIGHTLY_BASE_URL: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'Must use HTTPS')
      .default('https://american-football.highlightly.net'),
    HIGHLIGHTLY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
    HIGHLIGHTLY_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
    // M31C: optional embed-host allowlist (see embed-eligibility.ts). Comma-separated
    // hostnames; an explicit empty string disables the allowlist entirely (any HTTPS
    // embed URL that otherwise passes eligibility may embed) -- the default keeps the
    // known-good YouTube hosts from the real Highlightly samples evaluated so far.
    HIGHLIGHTLY_EMBED_HOST_ALLOWLIST: z
      .string()
      .default('youtube.com,www.youtube.com,youtube-nocookie.com,www.youtube-nocookie.com')
      .transform((value) =>
        value
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean),
      ),
    // M31C real-data finding: both real highlights checked so far reported
    // Highlightly-`embeddable: true` yet failed to actually play in a YouTube
    // iframe ("blocked it from display on this website or application") -- a
    // per-video/domain YouTube embedding permission Highlightly's API never
    // exposes. This global switch lets the eligibility pipeline keep computing
    // and persisting `canEmbed` (so it's ready to use again once resolved) while
    // forcing the public API to the canonical-link fallback in the meantime.
    // Defaults to disabled until real playback is confirmed working for a
    // meaningful sample of highlights.
    HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED: booleanSchema(false),
    CURRENT_GAME_POLLER_ENABLED: booleanSchema(false),
    CURRENT_GAME_POLLER_HEARTBEAT_SECONDS: z.coerce.number().int().min(15).max(60).default(20),
    CURRENT_GAME_POLLER_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(10),
    CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
    CURRENT_GAME_PREGAME_POLL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
    CURRENT_GAME_LIVE_POLL_SECONDS: z.coerce.number().int().min(30).max(1_800).default(120),
    CURRENT_GAME_FEATURED_POLL_SECONDS: z.coerce.number().int().min(15).max(1_800).default(60),
    CURRENT_GAME_HALFTIME_POLL_SECONDS: z.coerce.number().int().min(30).max(1_800).default(180),
    CURRENT_GAME_FINAL_RECONCILE_10_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
    CURRENT_GAME_FINAL_RECONCILE_60_MINUTES: z.coerce.number().int().min(1).max(360).default(60),
    CURRENT_GAME_RATE_LIMIT_DEGRADE_THRESHOLD: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000)
      .default(500),
  })
  .superRefine((value, context) => {
    if (
      value.CURRENT_GAME_FINAL_RECONCILE_60_MINUTES <= value.CURRENT_GAME_FINAL_RECONCILE_10_MINUTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CURRENT_GAME_FINAL_RECONCILE_60_MINUTES'],
        message: 'Must be greater than CURRENT_GAME_FINAL_RECONCILE_10_MINUTES',
      });
    }
    if (!value.HIGHLIGHTLY_EVALUATION_MODE && !value.HIGHLIGHTLY_PUBLICATION_APPROVED) {
      context.addIssue({
        code: 'custom',
        path: ['HIGHLIGHTLY_EVALUATION_MODE'],
        message: 'Must be true unless Highlightly publication is explicitly approved',
      });
    }
  });

const baseEnvironmentSchema = databaseEnvironmentSchema.extend({
  ...newsIngestionPolicyFields,
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGINS: corsOriginsSchema,
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  CURRENT_NFL_SEASON: z.coerce.number().int().min(1920).max(2100),
  ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS: booleanSchema(false),
  FIXTURE_DATA_ENABLED: booleanSchema(false),
  SPORTS_PROVIDER: z.enum(['mock', 'api-sports']).default('mock'),
  API_SPORTS_BASE_URL: z.url().default('https://v1.american-football.api-sports.io'),
  SPORTS_API: optionalSecretSchema,
  API_SPORTS_KEY: optionalSecretSchema,
  API_SPORTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  API_SPORTS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  API_SPORTS_SYNC_SEASON: z.coerce
    .number()
    .int()
    .min(1920)
    .max(2100)
    .default(new Date().getUTCFullYear()),
  API_SPORTS_SYNC_SEASON_TYPE: z.enum(['ALL', 'PRE', 'REG', 'POST']).default('ALL'),
  API_SPORTS_STORE_LOGO_URLS: booleanSchema(false),
  // M32: operator-curated Game Center videos. Comma-separated hostnames; an
  // explicit empty string disables the allowlist entirely. See
  // game-media-curation module and docs/game-center/admin-media-curation.md.
  GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST: z
    .string()
    .default('youtube.com,www.youtube.com,youtube-nocookie.com,www.youtube-nocookie.com')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
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
    EDITORIAL_AI_PROVIDER: z.enum(['none', 'openai']).default('none'),
    OPENAI_API_KEY: optionalSecretSchema,
    OPENAI_EDITORIAL_MODEL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).max(128).optional(),
    ),
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    EDITORIAL_AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  })
  .superRefine((value, context) => {
    validateSportsConfiguration(value, context);

    if (
      value.EDITORIAL_AI_PROVIDER === 'openai' &&
      (value.OPENAI_API_KEY === undefined || value.OPENAI_EDITORIAL_MODEL === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message:
          'OPENAI_API_KEY and OPENAI_EDITORIAL_MODEL are required when EDITORIAL_AI_PROVIDER is openai',
      });
    }

    if (value.REFRESH_COOKIE_SAME_SITE === 'none' && !value.REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['REFRESH_COOKIE_SECURE'],
        message: 'Must be true when REFRESH_COOKIE_SAME_SITE is none',
      });
    }

    if (value.NODE_ENV === 'production') {
      if (value.ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS) {
        context.addIssue({
          code: 'custom',
          path: ['ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS'],
          message: 'Must be false in production',
        });
      }
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
  readonly sports: SportsConfig;
  readonly editorialAi: {
    readonly provider: 'none' | 'openai';
    readonly apiKey: string | null;
    readonly model: string | null;
    readonly baseUrl: string;
    readonly timeoutMs: number;
  };
  readonly newsIngestion: NewsIngestionPolicy;
  readonly gameMediaCuration: {
    /** `null` disables embed-host allowlisting entirely. */
    readonly embedAllowedHosts: readonly string[] | null;
  };
}

export interface NewsIngestionPolicy {
  readonly initialLookbackHours: number;
  readonly initialMaxItemsPerSource: number;
  readonly lateItemToleranceHours: number;
}

export interface NewsIngestionConfig extends DatabaseConfig {
  readonly newsIngestion: NewsIngestionPolicy;
}

export interface SportsConfig {
  readonly provider: 'mock' | 'api-sports';
  readonly currentNflSeason: number;
  readonly allowHistoricalDefaultGameResults: boolean;
  readonly fixtureDataEnabled: boolean;
  readonly apiSports: {
    readonly baseUrl: string;
    readonly apiKey: string | null;
    readonly requestTimeoutMs: number;
    readonly maxRetries: number;
    readonly syncSeason: number;
    readonly syncSeasonType: 'PRE' | 'REG' | 'POST' | null;
    readonly storeLogoUrls: boolean;
  };
}

export interface SportsSyncConfig extends DatabaseConfig {
  readonly sports: SportsConfig;
}

export interface HighlightlyEvaluationConfig {
  readonly logLevel: DatabaseConfig['logLevel'];
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly evaluationSeason: number;
}

export interface CurrentGamePollerConfig {
  readonly enabled: boolean;
  readonly heartbeatSeconds: number;
  readonly batchSize: number;
  readonly lockLeaseSeconds: number;
  readonly pregamePollSeconds: number;
  readonly livePollSeconds: number;
  readonly featuredPollSeconds: number;
  readonly halftimePollSeconds: number;
  readonly finalReconcile10Minutes: number;
  readonly finalReconcile60Minutes: number;
  readonly rateLimitDegradeThreshold: number;
}

export interface CurrentGameSyncConfig extends DatabaseConfig {
  readonly currentGame: {
    readonly provider: 'highlightly';
    readonly evaluationMode: boolean;
    readonly publicationApproved: boolean;
    readonly highlightly: {
      readonly apiKey: string;
      readonly baseUrl: string;
      readonly requestTimeoutMs: number;
      readonly maxRetries: number;
    };
    /** `null` disables embed-host allowlisting entirely. See embed-eligibility.ts. */
    readonly embedAllowedHosts: readonly string[] | null;
    /** Global public-API kill-switch for `canEmbed`. See embed-eligibility.ts. */
    readonly embedPlaybackEnabled: boolean;
    readonly poller: CurrentGamePollerConfig;
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
  const data = parseEnvironment(databaseEnvironmentSchema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
  };
}

export function loadNewsIngestionConfig(
  environment: Record<string, string | undefined> = process.env,
): NewsIngestionConfig {
  const data = parseEnvironment(newsIngestionEnvironmentSchema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
    newsIngestion: toNewsIngestionPolicy(data),
  };
}

export function loadSportsSyncConfig(
  environment: Record<string, string | undefined> = process.env,
): SportsSyncConfig {
  const schema = baseEnvironmentSchema.superRefine(validateSportsConfiguration);
  const data = parseEnvironment(schema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
    sports: toSportsConfig(data),
  };
}

export function loadHighlightlyEvaluationConfig(
  environment: Record<string, string | undefined> = process.env,
): HighlightlyEvaluationConfig {
  const data = parseEnvironment(highlightlyEvaluationEnvironmentSchema, environment);
  const evaluationSeason = data.HIGHLIGHTLY_EVALUATION_SEASON ?? data.CURRENT_NFL_SEASON;
  if (evaluationSeason === undefined) {
    throw new EnvironmentValidationError(['HIGHLIGHTLY_EVALUATION_SEASON: Is required']);
  }
  return {
    logLevel: data.LOG_LEVEL,
    apiKey: data.HIGHLIGHTLY_API_KEY,
    baseUrl: data.HIGHLIGHTLY_BASE_URL,
    requestTimeoutMs: data.HIGHLIGHTLY_REQUEST_TIMEOUT_MS,
    maxRetries: data.HIGHLIGHTLY_MAX_RETRIES,
    evaluationSeason,
  };
}

export function loadCurrentGameSyncConfig(
  environment: Record<string, string | undefined> = process.env,
): CurrentGameSyncConfig {
  const data = parseEnvironment(currentGameEnvironmentSchema, environment);
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    logLevel: data.LOG_LEVEL,
    currentGame: {
      provider: data.CURRENT_GAME_PROVIDER,
      evaluationMode: data.HIGHLIGHTLY_EVALUATION_MODE,
      publicationApproved: data.HIGHLIGHTLY_PUBLICATION_APPROVED,
      highlightly: {
        apiKey: data.HIGHLIGHTLY_API_KEY,
        baseUrl: data.HIGHLIGHTLY_BASE_URL,
        requestTimeoutMs: data.HIGHLIGHTLY_REQUEST_TIMEOUT_MS,
        maxRetries: data.HIGHLIGHTLY_MAX_RETRIES,
      },
      embedAllowedHosts:
        data.HIGHLIGHTLY_EMBED_HOST_ALLOWLIST.length > 0
          ? data.HIGHLIGHTLY_EMBED_HOST_ALLOWLIST
          : null,
      embedPlaybackEnabled: data.HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED,
      poller: {
        enabled: data.CURRENT_GAME_POLLER_ENABLED,
        heartbeatSeconds: data.CURRENT_GAME_POLLER_HEARTBEAT_SECONDS,
        batchSize: data.CURRENT_GAME_POLLER_BATCH_SIZE,
        lockLeaseSeconds: data.CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS,
        pregamePollSeconds: data.CURRENT_GAME_PREGAME_POLL_SECONDS,
        livePollSeconds: data.CURRENT_GAME_LIVE_POLL_SECONDS,
        featuredPollSeconds: data.CURRENT_GAME_FEATURED_POLL_SECONDS,
        halftimePollSeconds: data.CURRENT_GAME_HALFTIME_POLL_SECONDS,
        finalReconcile10Minutes: data.CURRENT_GAME_FINAL_RECONCILE_10_MINUTES,
        finalReconcile60Minutes: data.CURRENT_GAME_FINAL_RECONCILE_60_MINUTES,
        rateLimitDegradeThreshold: data.CURRENT_GAME_RATE_LIMIT_DEGRADE_THRESHOLD,
      },
    },
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
    sports: toSportsConfig(data),
    editorialAi: {
      provider: data.EDITORIAL_AI_PROVIDER,
      apiKey: data.OPENAI_API_KEY ?? null,
      model: data.OPENAI_EDITORIAL_MODEL ?? null,
      baseUrl: data.OPENAI_BASE_URL,
      timeoutMs: data.EDITORIAL_AI_TIMEOUT_MS,
    },
    newsIngestion: toNewsIngestionPolicy(data),
    gameMediaCuration: {
      embedAllowedHosts:
        data.GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST.length > 0
          ? data.GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST
          : null,
    },
  };
}

function toNewsIngestionPolicy(data: {
  readonly NEWS_INITIAL_INGEST_LOOKBACK_HOURS: number;
  readonly NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE: number;
  readonly NEWS_LATE_ITEM_TOLERANCE_HOURS: number;
}): NewsIngestionPolicy {
  return {
    initialLookbackHours: data.NEWS_INITIAL_INGEST_LOOKBACK_HOURS,
    initialMaxItemsPerSource: data.NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE,
    lateItemToleranceHours: data.NEWS_LATE_ITEM_TOLERANCE_HOURS,
  };
}

function toSportsConfig(data: z.output<typeof baseEnvironmentSchema>): SportsConfig {
  return {
    provider: data.SPORTS_PROVIDER,
    currentNflSeason: data.CURRENT_NFL_SEASON,
    allowHistoricalDefaultGameResults: data.ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS,
    fixtureDataEnabled: data.FIXTURE_DATA_ENABLED,
    apiSports: {
      baseUrl: data.API_SPORTS_BASE_URL,
      apiKey: data.SPORTS_API ?? data.API_SPORTS_KEY ?? null,
      requestTimeoutMs: data.API_SPORTS_REQUEST_TIMEOUT_MS,
      maxRetries: data.API_SPORTS_MAX_RETRIES,
      syncSeason: data.API_SPORTS_SYNC_SEASON,
      syncSeasonType:
        data.API_SPORTS_SYNC_SEASON_TYPE === 'ALL' ? null : data.API_SPORTS_SYNC_SEASON_TYPE,
      storeLogoUrls: data.API_SPORTS_STORE_LOGO_URLS,
    },
  };
}

function validateSportsConfiguration(
  value: z.output<typeof baseEnvironmentSchema>,
  context: z.RefinementCtx,
): void {
  if (
    value.SPORTS_API !== undefined &&
    value.API_SPORTS_KEY !== undefined &&
    value.SPORTS_API !== value.API_SPORTS_KEY
  ) {
    context.addIssue({
      code: 'custom',
      path: ['SPORTS_API'],
      message: 'Must match API_SPORTS_KEY when both variables are set',
    });
  }

  if (
    value.SPORTS_PROVIDER === 'api-sports' &&
    value.SPORTS_API === undefined &&
    value.API_SPORTS_KEY === undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['SPORTS_API'],
      message: 'Is required when SPORTS_PROVIDER is api-sports',
    });
  }
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
