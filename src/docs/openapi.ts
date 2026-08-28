const gameListQueryParameters = [
  { name: 'season', in: 'query', schema: { type: 'integer', minimum: 1920, maximum: 2100 } },
  { name: 'seasonType', in: 'query', schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] } },
  { name: 'week', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 22 } },
  {
    name: 'startDate',
    in: 'query',
    description: 'UTC ISO 8601 date or timestamp. Must be paired with endDate.',
    schema: { type: 'string' },
  },
  {
    name: 'endDate',
    in: 'query',
    description: 'Inclusive UTC ISO 8601 date or timestamp. Ranges are limited to 31 days.',
    schema: { type: 'string' },
  },
  { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/GameStatus' } },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
] as const;

const statsMetricIds = [
  'passing_yards',
  'passing_touchdowns',
  'completions',
  'passing_attempts',
  'interceptions_thrown',
  'rushing_yards',
  'rushing_touchdowns',
  'rushing_attempts',
  'receiving_yards',
  'receiving_touchdowns',
  'receptions',
  'targets',
  'tackles',
  'solo_tackles',
  'sacks',
  'defensive_interceptions',
  'forced_fumbles',
  'field_goals_made',
  'field_goals_attempted',
  'extra_points_made',
] as const;

const statsSharedLeaderboardParameters = [
  {
    name: 'season',
    in: 'query',
    required: true,
    description: 'An imported season returned by /stats/metadata.',
    schema: { type: 'integer', minimum: 1920, maximum: 2100 },
  },
  {
    name: 'metric',
    in: 'query',
    required: true,
    description: 'Stable allowlisted metric ID. Database field names are not accepted.',
    schema: { type: 'string', enum: statsMetricIds },
  },
  { name: 'position', in: 'query', schema: { type: 'string', maxLength: 24 } },
  { name: 'positionGroup', in: 'query', schema: { type: 'string', maxLength: 24 } },
  {
    name: 'teamId',
    in: 'query',
    description:
      'Application-owned team UUID. Season leaders aggregate only statistics recorded for this team.',
    schema: { type: 'string', format: 'uuid' },
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: 'cursor',
    in: 'query',
    description: 'Opaque context-bound cursor returned by the preceding page.',
    schema: { type: 'string', maxLength: 1024 },
  },
] as const;

const publicArticleQueryParameters = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
  { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/ArticleType' } },
  { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  {
    name: 'team',
    in: 'query',
    description: 'Active NFL team abbreviation.',
    schema: { type: 'string' },
  },
  { name: 'featured', in: 'query', schema: { type: 'boolean' } },
  { name: 'publishedFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
  { name: 'publishedTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
  { name: 'search', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 100 } },
] as const;

const articleIdParameter = {
  name: 'articleId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const teamHomepageTeamIdParameter = {
  name: 'teamId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const teamHomepagePlacementIdParameter = {
  name: 'placementId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

function adminTeamHomepageOperation(
  operationId: string,
  summary: string,
  parameters: readonly Record<string, unknown>[],
  requestSchema?: Record<string, unknown>,
  successStatus = '200',
) {
  return {
    operationId,
    summary,
    tags: ['Admin Team Homepage'],
    security: [{ bearerAuth: [] }],
    parameters,
    ...(requestSchema === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: requestSchema } },
          },
        }),
    responses: {
      [successStatus]: {
        description: 'The Team Homepage CMS operation completed.',
        ...(successStatus === '204'
          ? {}
          : { content: { 'application/json': { schema: { type: 'object' } } } }),
      },
      '400': { $ref: '#/components/responses/ValidationError' },
      '401': { $ref: '#/components/responses/UnauthorizedError' },
      '403': { $ref: '#/components/responses/ForbiddenError' },
      '404': { $ref: '#/components/responses/NotFoundError' },
      '409': { $ref: '#/components/responses/ConflictError' },
    },
  };
}

const articleVersionActionBody = {
  required: true,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ArticleVersionActionRequest' } },
  },
} as const;

const newsSourceIdParameter = {
  name: 'sourceId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

const newsCandidateIdParameter = {
  name: 'candidateId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

function newsActionPath(
  operationId: string,
  summary: string,
  parameter: typeof newsSourceIdParameter | typeof newsCandidateIdParameter,
  responseSchema: string,
  requestSchema?: string,
  created = false,
) {
  return {
    post: {
      operationId,
      summary,
      tags: ['News Source Inbox'],
      security: [{ bearerAuth: [] }],
      parameters: [parameter],
      ...(requestSchema === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: requestSchema } },
              },
            },
          }),
      responses: {
        [created ? '201' : '200']: {
          description: created ? 'Resource created.' : 'Operation completed.',
          content: { 'application/json': { schema: { $ref: responseSchema } } },
        },
        '400': { $ref: '#/components/responses/ValidationError' },
        '401': { $ref: '#/components/responses/UnauthorizedError' },
        '403': { $ref: '#/components/responses/ForbiddenError' },
        '404': { $ref: '#/components/responses/NotFoundError' },
        '409': { $ref: '#/components/responses/ConflictError' },
        '429': { $ref: '#/components/responses/RateLimitError' },
      },
    },
  };
}

function articleActionPath(operationId: string, summary: string, scheduled: boolean) {
  return {
    post: {
      operationId,
      summary,
      tags: ['Editorial CMS'],
      security: [{ bearerAuth: [] }],
      parameters: [articleIdParameter],
      requestBody: scheduled
        ? {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ArticleScheduleRequest' },
              },
            },
          }
        : articleVersionActionBody,
      responses: {
        '200': {
          description: 'Article lifecycle transition and immutable revision.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminArticleDetailResponse' },
            },
          },
        },
        '400': { $ref: '#/components/responses/ValidationError' },
        '401': { $ref: '#/components/responses/UnauthorizedError' },
        '403': { $ref: '#/components/responses/ForbiddenError' },
        '404': { $ref: '#/components/responses/NotFoundError' },
        '409': { $ref: '#/components/responses/ConflictError' },
      },
    },
  };
}

const articleEditorialProperties = {
  type: { $ref: '#/components/schemas/ArticleType' },
  title: { type: 'string', minLength: 1, maxLength: 180 },
  slug: { type: 'string', minLength: 1, maxLength: 160 },
  summary: { type: ['string', 'null'], maxLength: 1000 },
  body: {
    type: ['string', 'null'],
    maxLength: 100000,
    description:
      'Markdown only; embedded HTML is rejected. Curated commentary is limited to 2,000 characters.',
  },
  sourceName: { type: ['string', 'null'], maxLength: 160 },
  sourceUrl: { type: ['string', 'null'], format: 'uri' },
  sourcePublishedAt: { type: ['string', 'null'], format: 'date-time' },
  heroImageUrl: { type: ['string', 'null'], format: 'uri' },
  heroImageAlt: { type: ['string', 'null'], maxLength: 300 },
  heroImageAttribution: { type: ['string', 'null'], maxLength: 500 },
  heroImageAttributionUrl: { type: ['string', 'null'], format: 'uri' },
  seoTitle: { type: ['string', 'null'], maxLength: 180 },
  seoDescription: { type: ['string', 'null'], maxLength: 320 },
  isFeatured: { type: 'boolean' },
  featuredPriority: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
  featuredStartsAt: { type: ['string', 'null'], format: 'date-time' },
  featuredEndsAt: { type: ['string', 'null'], format: 'date-time' },
  teamIds: {
    type: 'array',
    maxItems: 32,
    uniqueItems: true,
    items: { type: 'string', format: 'uuid' },
  },
  changeSummary: { type: ['string', 'null'], maxLength: 500 },
} as const;

function dataResponse(reference: string) {
  return {
    type: 'object',
    required: ['data'],
    properties: { data: { $ref: reference } },
  };
}

function articleListResponse(reference: string) {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'array', items: { $ref: reference } },
      meta: {
        type: 'object',
        required: ['nextCursor'],
        properties: { nextCursor: { type: ['string', 'null'], format: 'uuid' } },
      },
    },
  };
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: '2nd and 15 API',
    version: '0.1.0',
    description: 'Versioned backend API for the 2nd and 15 NFL platform.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/ai-hub/predictions': {
      get: {
        tags: ['AI Hub'],
        summary: 'List the latest public weekly game predictions',
        parameters: [
          { name: 'season', in: 'query', schema: { type: 'integer' } },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          },
          { name: 'week', in: 'query', schema: { type: 'integer' } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['UPCOMING', 'COMPLETED'] },
          },
        ],
        responses: {
          200: {
            description:
              'Published prediction list. Private feature and AI usage snapshots are excluded.',
          },
        },
      },
    },
    '/ai-hub/summary': {
      get: {
        tags: ['AI Hub'],
        summary: 'Get a compact prediction summary',
        responses: { 200: { description: 'Compact latest-public prediction summary.' } },
      },
    },
    '/ai-hub/weekly-insights': {
      get: {
        tags: ['AI Hub'],
        summary: 'Get deterministic Tier 1 intelligence from published weekly predictions',
        parameters: [
          { name: 'season', in: 'query', required: true, schema: { type: 'integer' } },
          {
            name: 'seasonType',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          },
          { name: 'week', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'top',
            in: 'query',
            description: 'Maximum ranked cards per list.',
            schema: { type: 'integer', minimum: 1, maximum: 5, default: 5 },
          },
        ],
        responses: {
          200: {
            description:
              'Derived weekly cards, optional favorite-team view, and evaluated model performance. Raw feature snapshots remain private.',
          },
          400: { description: 'Invalid or unbounded query.' },
          404: { description: 'No eligible published predictions for the selected week.' },
        },
      },
    },
    '/ai-hub/performance': {
      get: {
        tags: ['AI Hub'],
        summary: 'Get evaluated prediction accuracy and Brier score',
        responses: {
          200: { description: 'Aggregate performance; ties are excluded from accuracy.' },
        },
      },
    },
    '/ai-hub/predictions/{gameId}': {
      get: {
        tags: ['AI Hub'],
        summary: 'Get the latest public prediction for a game',
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: { description: 'Prediction detail.' },
          404: { description: 'No published prediction.' },
        },
      },
    },
    '/admin/predictions/generate': {
      post: {
        tags: ['AI Hub Admin'],
        summary: 'Dry-run or persist bounded game/weekly predictions',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  gameId: { type: 'string', format: 'uuid' },
                  season: { type: 'integer' },
                  seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
                  week: { type: ['integer', 'null'] },
                  dryRun: { type: 'boolean', default: true },
                  retrospective: { type: 'boolean', default: false },
                  includeAiExplanation: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Generation result. Dry-run performs no database writes.' },
          409: { description: 'Kickoff or retrospective-state conflict.' },
        },
      },
    },
    '/admin/predictions/evaluate': {
      post: {
        tags: ['AI Hub Admin'],
        summary: 'Lock started predictions and evaluate final games',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Lock/evaluation counts.' } },
      },
    },
    '/admin/predictions/{predictionId}/publish': {
      post: {
        tags: ['AI Hub Admin'],
        summary: 'Explicitly publish a draft prediction',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'predictionId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: { description: 'Published prediction.' },
          409: { description: 'Retrospective predictions cannot be published.' },
        },
      },
    },
    '/auth/register': {
      post: {
        operationId: 'register',
        summary: 'Register and start an authenticated session',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
          },
        },
        responses: {
          '201': {
            description:
              'Account and session created. The refresh token is set as an HttpOnly cookie.',
            headers: {
              'Set-Cookie': { schema: { type: 'string' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '409': { $ref: '#/components/responses/ConflictError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/auth/login': {
      post: {
        operationId: 'login',
        summary: 'Authenticate with email and password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated. The refresh token is set as an HttpOnly cookie.',
            headers: {
              'Set-Cookie': { schema: { type: 'string' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        operationId: 'refreshAccessToken',
        summary: 'Rotate the refresh session and issue a new access token',
        description:
          'Reads the refresh token only from its HttpOnly cookie. Browser clients must send credentials.',
        tags: ['Authentication'],
        responses: {
          '200': {
            description: 'The refresh token was rotated and replaced in the cookie.',
            headers: {
              'Set-Cookie': { schema: { type: 'string' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/auth/logout': {
      post: {
        operationId: 'logout',
        summary: 'Revoke the current refresh session and clear its cookie',
        tags: ['Authentication'],
        responses: {
          '204': {
            description: 'The operation completed, including when no current session existed.',
            headers: {
              'Set-Cookie': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        operationId: 'forgotPassword',
        summary: 'Request password-reset instructions',
        description: 'Always returns the same response regardless of whether the account exists.',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ForgotPasswordRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'The generic password-reset request response.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        operationId: 'resetPassword',
        summary: 'Consume a single-use token and replace the password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Password changed and all refresh sessions revoked.',
            headers: {
              'Set-Cookie': { schema: { type: 'string' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/users/me': {
      get: {
        operationId: 'getCurrentUser',
        summary: 'Get the authenticated user',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'The authenticated active user.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CurrentUserResponse' } },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/users/me/favorite-team': {
      patch: {
        operationId: 'updateFavoriteTeam',
        summary: 'Set, replace, or clear the authenticated user’s favorite NFL team',
        description:
          'Uses an internal team UUID. Send null to clear the relationship. Provider mappings are never returned.',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateFavoriteTeamRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'The favorite team was set, replaced, or cleared.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CurrentUserResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '404': {
            description: 'The supplied internal team ID does not exist.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '409': {
            description: 'The supplied team exists but is inactive and cannot be selected.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/articles': {
      get: {
        operationId: 'listArticles',
        summary: 'List publicly visible articles without full bodies',
        tags: ['Articles'],
        parameters: publicArticleQueryParameters,
        responses: {
          '200': {
            description: 'Cursor-paginated visible articles.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicArticleListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/articles/featured': {
      get: {
        operationId: 'listFeaturedArticles',
        summary: 'List active featured articles in deterministic priority order',
        tags: ['Articles'],
        parameters: publicArticleQueryParameters,
        responses: {
          '200': {
            description: 'Cursor-paginated featured articles.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicArticleListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/articles/{slug}': {
      get: {
        operationId: 'getArticleBySlug',
        summary: 'Get one publicly visible article',
        tags: ['Articles'],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Public article detail including safe Markdown source.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicArticleDetailResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/teams/{teamId}/articles': {
      get: {
        operationId: 'listTeamArticles',
        summary: 'List publicly visible articles tagged to an active team',
        tags: ['Articles'],
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          ...publicArticleQueryParameters,
        ],
        responses: {
          '200': {
            description: 'Cursor-paginated team articles.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicArticleListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/articles': {
      get: {
        operationId: 'listAdminArticles',
        summary: 'List editorial articles without large bodies',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/ArticleStatus' } },
          { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/ArticleType' } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'featured', in: 'query', schema: { type: 'boolean' } },
          { name: 'authorId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 100 } },
        ],
        responses: {
          '200': {
            description: 'Administrative article summaries.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminArticleListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      post: {
        operationId: 'createArticle',
        summary: 'Create an editorial draft',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ArticleCreateRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Draft created with revision 1.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminArticleDetailResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}': {
      get: {
        operationId: 'getAdminArticle',
        summary: 'Get full editorial article detail',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        responses: {
          '200': {
            description: 'Administrative article detail.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminArticleDetailResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
      patch: {
        operationId: 'updateArticle',
        summary: 'Edit an article using optimistic concurrency',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ArticleUpdateRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Updated article and new revision.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminArticleDetailResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}/teams': {
      put: {
        operationId: 'replaceArticleTeams',
        summary: 'Replace active NFL team tags',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ArticleTeamsRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Article with updated tags and revision.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminArticleDetailResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}/publish': articleActionPath(
      'publishArticle',
      'Publish an article',
      false,
    ),
    '/admin/articles/{articleId}/unpublish': articleActionPath(
      'unpublishArticle',
      'Unpublish an article',
      false,
    ),
    '/admin/articles/{articleId}/archive': articleActionPath(
      'archiveArticle',
      'Archive an article (admin only)',
      false,
    ),
    '/admin/articles/{articleId}/restore': articleActionPath(
      'restoreArticle',
      'Restore an archived article (admin only)',
      false,
    ),
    '/admin/articles/{articleId}/schedule': articleActionPath(
      'scheduleArticle',
      'Schedule future publication',
      true,
    ),
    '/admin/articles/{articleId}/revisions': {
      get: {
        operationId: 'listArticleRevisions',
        summary: 'List immutable article revisions',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [
          articleIdParameter,
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Article revision page.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ArticleRevisionListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/articles/{articleId}/revisions/{revisionId}': {
      get: {
        operationId: 'getArticleRevision',
        summary: 'Get one immutable article revision',
        tags: ['Editorial CMS'],
        security: [{ bearerAuth: [] }],
        parameters: [
          articleIdParameter,
          {
            name: 'revisionId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Article revision.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ArticleRevisionResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/news-sources': {
      get: {
        operationId: 'listNewsSources',
        summary: 'List approved news sources and health summaries',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'status',
            in: 'query',
            schema: { $ref: '#/components/schemas/NewsSourceStatus' },
          },
          { name: 'kind', in: 'query', schema: { $ref: '#/components/schemas/NewsSourceKind' } },
          {
            name: 'contentType',
            in: 'query',
            schema: { $ref: '#/components/schemas/NewsContentType' },
          },
        ],
        responses: {
          '200': {
            description: 'Bounded source page.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NewsSourceListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      post: {
        operationId: 'createNewsSource',
        summary: 'Create an approved source definition (admin only)',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewsSourceCreateRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Source created without automatic ingestion.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NewsSourceResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/news-sources/{sourceId}': {
      get: {
        operationId: 'getNewsSource',
        summary: 'Get one source and its 20 most recent ingestion runs',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        parameters: [newsSourceIdParameter],
        responses: {
          '200': {
            description: 'Source health and bounded run history.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NewsSourceDetailResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
      patch: {
        operationId: 'updateNewsSource',
        summary: 'Update a source definition (admin only)',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        parameters: [newsSourceIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewsSourceUpdateRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated source.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NewsSourceResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/news-sources/{sourceId}/test': newsActionPath(
      'testNewsSource',
      'Fetch and parse a source without writing candidates',
      newsSourceIdParameter,
      '#/components/schemas/NewsIngestionResponse',
    ),
    '/admin/news-sources/{sourceId}/ingest': newsActionPath(
      'ingestNewsSource',
      'Manually fetch a source and upsert candidate metadata',
      newsSourceIdParameter,
      '#/components/schemas/NewsIngestionResponse',
    ),
    '/admin/news-sources/{sourceId}/pause': newsActionPath(
      'pauseNewsSource',
      'Pause a source (admin only)',
      newsSourceIdParameter,
      '#/components/schemas/NewsSourceResponse',
    ),
    '/admin/news-sources/{sourceId}/resume': newsActionPath(
      'resumeNewsSource',
      'Resume a source (admin only)',
      newsSourceIdParameter,
      '#/components/schemas/NewsSourceResponse',
    ),
    '/admin/news-candidates': {
      get: {
        operationId: 'listNewsCandidates',
        summary: 'List candidate-story inbox metadata',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'status',
            in: 'query',
            schema: { $ref: '#/components/schemas/NewsCandidateStatus' },
          },
          { name: 'sourceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'publishedFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'publishedTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 100 } },
        ],
        responses: {
          '200': {
            description: 'Bounded candidate page without source descriptions.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NewsCandidateListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/news-candidates/manual': {
      post: {
        operationId: 'createManualNewsCandidate',
        summary: 'Submit candidate metadata without fetching the article page',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ManualNewsCandidateRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Manual candidate created and audited.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NewsCandidateResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/news-candidates/{candidateId}': {
      get: {
        operationId: 'getNewsCandidate',
        summary: 'Get one candidate with bounded source description',
        tags: ['News Source Inbox'],
        security: [{ bearerAuth: [] }],
        parameters: [newsCandidateIdParameter],
        responses: {
          '200': {
            description: 'Candidate detail.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NewsCandidateResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/news-candidates/{candidateId}/review': newsActionPath(
      'reviewNewsCandidate',
      'Move a candidate into review',
      newsCandidateIdParameter,
      '#/components/schemas/NewsCandidateResponse',
    ),
    '/admin/news-candidates/{candidateId}/save': newsActionPath(
      'saveNewsCandidate',
      'Save a candidate for later',
      newsCandidateIdParameter,
      '#/components/schemas/NewsCandidateResponse',
    ),
    '/admin/news-candidates/{candidateId}/dismiss': newsActionPath(
      'dismissNewsCandidate',
      'Dismiss a candidate with a retained reason',
      newsCandidateIdParameter,
      '#/components/schemas/NewsCandidateResponse',
      '#/components/schemas/NewsCandidateDismissRequest',
    ),
    '/admin/news-candidates/{candidateId}/convert': newsActionPath(
      'convertNewsCandidate',
      'Create a CURATED CMS draft from editor-written content',
      newsCandidateIdParameter,
      '#/components/schemas/NewsCandidateConversionResponse',
      '#/components/schemas/NewsCandidateConvertRequest',
      true,
    ),
    '/admin/news-candidates/{candidateId}/generate-draft': {
      post: {
        operationId: 'generateEditorialAiDraft',
        summary: 'Generate an original attributed draft for human review',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [newsCandidateIdParameter],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EditorialAiGenerateRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'DRAFT created in NEEDS_REVIEW.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EditorialAiDraftResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
          '503': { description: 'Editorial AI is unavailable or unconfigured.' },
        },
      },
    },
    '/admin/news-candidates/generate-drafts': {
      post: {
        operationId: 'generateEditorialAiDraftBatch',
        summary: 'Generate a bounded batch of independent review drafts',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EditorialAiBatchRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Per-candidate bounded batch result.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/news-candidates/{candidateId}/evaluate': {
      post: {
        operationId: 'evaluateNewsCandidateQuality',
        summary:
          'Evaluate private NFL relevance, sufficiency, duplicate risk, and generation eligibility',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [newsCandidateIdParameter],
        responses: {
          '200': {
            description: 'Persisted private quality evaluation; no article is created.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CandidateQualityResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/news-candidates/evaluate-batch': {
      post: {
        operationId: 'evaluateNewsCandidateQualityBatch',
        summary: 'Evaluate up to 50 candidates without generating articles',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CandidateQualityBatchRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Bounded partial-failure evaluation summary.' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/news-candidates/{candidateId}/quality-override': {
      post: {
        operationId: 'overrideNewsCandidateQuality',
        summary: 'Record an audited manual quality override without publishing',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [newsCandidateIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CandidateQualityOverrideRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Private overridden quality evaluation.' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/editorial/coverage': {
      get: {
        operationId: 'getEditorialLaunchCoverage',
        summary: 'Report launch coverage for all active NFL teams',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'target',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 7 },
          },
        ],
        responses: {
          '200': {
            description: 'Per-team published, draft, candidate, recent, video, and target counts.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EditorialCoverageResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/data-health/games': {
      get: {
        operationId: 'listDataHealthGames',
        summary: 'DB-only coverage overview across current-season games (never calls Highlightly)',
        tags: ['Data Health'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'season', in: 'query', schema: { type: 'integer' } },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          },
          { name: 'week', in: 'query', schema: { type: 'integer' } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'gameStatus', in: 'query', schema: { type: 'string' } },
          { name: 'issuesOnly', in: 'query', schema: { type: 'boolean' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description:
              'Per-game coverage rows plus aggregate summary counts for the active filter.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DataHealthGameListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/data-health/games/{gameId}': {
      get: {
        operationId: 'getDataHealthGame',
        summary: 'DB-only deep coverage diagnostics for one game (never calls Highlightly)',
        tags: ['Data Health'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Result, team-stat, player-stat, play, poller, and last-probe detail.',
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/data-health/games/{gameId}/probes': {
      get: {
        operationId: 'listDataHealthProbes',
        summary:
          'Recent saved provider-probe diagnostics for one game (DB-only, does not run a new probe)',
        tags: ['Data Health'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 20 },
          },
        ],
        responses: {
          '200': { description: 'Most recent probes for this game, newest first.' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/data-health/games/{gameId}/probe': {
      post: {
        operationId: 'runDataHealthProbe',
        summary:
          'Run one explicit, bounded Highlightly probe for a game (ADMIN only; never mutates production data)',
        tags: ['Data Health'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description:
              'Provider-vs-database comparison with deterministic diagnosis codes. Uses at most 2 Highlightly requests.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DataHealthProbeResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { description: 'The Highlightly probe is not configured on this server.' },
        },
      },
    },
    '/admin/editorial/discover-launch-candidates': {
      post: {
        operationId: 'discoverLaunchNewsCandidates',
        summary: 'Run bounded launch discovery through approved active RSS/Atom sources',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LaunchDiscoveryRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Discovery/evaluation report; never generates or publishes articles.',
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}/editorial-review': {
      post: {
        operationId: 'reviewEditorialAiDraft',
        summary: 'Approve or reject an AI draft without publishing it',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['status'],
                properties: { status: { type: 'string', enum: ['APPROVED', 'REJECTED'] } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Private review state updated.' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}/regenerate': {
      post: {
        operationId: 'regenerateEditorialAiDraft',
        summary: 'Regenerate the current unpublished AI draft',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['expectedVersion'],
                properties: {
                  expectedVersion: { type: 'integer', minimum: 1 },
                  instruction: { type: 'string', minLength: 1, maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Draft regenerated, revisioned, audited, and returned to NEEDS_REVIEW.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EditorialAiDraftResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/articles/{articleId}/media-candidates': {
      post: {
        operationId: 'createArticleMediaCandidate',
        summary: 'Store an external media suggestion without downloading it',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [articleIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ArticleMediaCandidateRequest' },
            },
          },
        },
        responses: {
          '201': { description: 'Media suggestion stored.' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/articles/{articleId}/media/{mediaCandidateId}/attach': {
      post: {
        operationId: 'attachArticleMediaCandidate',
        summary: 'Attach rights-compatible embeddable media',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [
          articleIdParameter,
          {
            name: 'mediaCandidateId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': { description: 'Media attached as the primary media.' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/news-sources/{sourceId}/rights': {
      get: {
        operationId: 'getSourceRightsProfile',
        summary: 'Read conservative source-rights metadata',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [newsSourceIdParameter],
        responses: {
          '200': { description: 'Configured profile or conservative UNKNOWN defaults.' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      put: {
        operationId: 'updateSourceRightsProfile',
        summary: 'Review source text, image, video, and quotation rights (admin only)',
        tags: ['Editorial AI'],
        security: [{ bearerAuth: [] }],
        parameters: [newsSourceIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SourceRightsProfileRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Rights profile reviewed and audited.' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/admin/games': {
      get: {
        operationId: 'listAdminGames',
        summary: 'List schedule records with provenance and overrides',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'season',
            in: 'query',
            schema: { type: 'integer', minimum: 1920, maximum: 2100 },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Administrative game page.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminGameListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      post: {
        operationId: 'createAdminGame',
        summary: 'Create a manually maintained NFL game',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ManualGameCreateRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Manual game created and audited.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/games/{gameId}': {
      get: {
        operationId: 'getAdminGame',
        summary: 'Get one administrative game record',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Administrative game detail.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': {
            description: 'Game not found.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
      patch: {
        operationId: 'updateAdminGame',
        summary: 'Edit a manually owned base game',
        description: 'Provider-backed games must use an editorial override.',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ManualGameUpdateRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Manual game updated and verification cleared.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/games/{gameId}/override': {
      put: {
        operationId: 'upsertGameOverride',
        summary: 'Create or partially update an editorial game override',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GameOverrideRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Override created or updated and audited.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      delete: {
        operationId: 'deleteGameOverride',
        summary: 'Remove an editorial game override (admin only)',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Override removed and audited.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': {
            description: 'Game or override not found.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        },
      },
    },
    '/admin/games/{gameId}/verification': {
      put: {
        operationId: 'verifyAdminGame',
        summary: 'Mark schedule facts as editor-verified',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GameVerificationRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Verification recorded and audited.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminGameResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/admin/games/{gameId}/result-fallback': {
      put: {
        operationId: 'upsertGameResultFallback',
        summary: 'Dry-run or apply a sourced reviewed final-result fallback',
        description:
          'Updates only an existing reviewed game through editorial precedence. It never creates a game or team statistics.',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GameResultFallbackRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Mutation-free plan, applied result, or idempotent no-op.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GameResultFallbackResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '409': { $ref: '#/components/responses/ConflictError' },
        },
      },
    },
    '/admin/schedule-imports/validate': {
      post: {
        operationId: 'validateScheduleImport',
        summary: 'Validate and match schedule rows without mutation',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ScheduleImportRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Sanitized dry-run summary.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScheduleImportResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/admin/schedule-imports': {
      post: {
        operationId: 'importSchedule',
        summary: 'Validate and optionally write schedule rows',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ScheduleImportRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Sanitized import summary.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScheduleImportResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/admin/audit-events': {
      get: {
        operationId: 'listAdminAuditEvents',
        summary: 'List game-scoped (editor) or complete (admin) audit history',
        tags: ['Administration'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          {
            name: 'entityType',
            in: 'query',
            description:
              'Editors may supply GAME, or ARTICLE together with entityId; admins may omit this filter.',
            schema: { type: 'string' },
          },
          { name: 'entityId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Paginated sanitized audit events.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuditEventListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Check process health',
        tags: ['System'],
        responses: {
          '200': {
            description: 'The API process is healthy.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          '429': {
            description: 'The request rate limit was exceeded.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/stats/metadata': {
      get: {
        operationId: 'getStatsMetadata',
        summary: 'Get public Stats Hub capabilities and data coverage',
        tags: ['Stats Hub'],
        description:
          'Returns stable metric IDs, imported seasons, exact position filters, limits, competition-ranking semantics, coverage notes, and nflverse attribution. Internal columns and import metadata remain private.',
        responses: {
          '200': {
            description: 'Cacheable public Stats Hub metadata.',
            headers: {
              'Cache-Control': { schema: { type: 'string' } },
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsMetadataResponse' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/stats/leaders': {
      get: {
        operationId: 'getSeasonStatLeaders',
        summary: 'Get a historical player-season leaderboard',
        tags: ['Stats Hub'],
        description:
          'Returns competition ranks (1, 2, 2, 4). Equal values share rank; ties are ordered by games descending, display name ascending, then internal player UUID. Without teamId, rows use stored season summaries and identify SINGLE or MULTI team context. With teamId, values and games are aggregated only from performances recorded for that team. Nulls are excluded; recorded zeroes remain eligible.',
        parameters: [
          ...statsSharedLeaderboardParameters,
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['REG', 'POST', 'REG_POST'], default: 'REG' },
          },
        ],
        responses: {
          '200': {
            description: 'A deterministic cursor-paginated season leaderboard.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsSeasonLeaderboardResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/stats/weekly-leaders': {
      get: {
        operationId: 'getWeeklyStatLeaders',
        summary: 'Get a historical weekly player leaderboard',
        tags: ['Stats Hub'],
        description:
          'Ranks stored player/game/team performances. A player with distinct performances for two teams in one week remains two transparent rows with internal game, team, and opponent IDs. REG_POST is intentionally unsupported.',
        parameters: [
          ...statsSharedLeaderboardParameters,
          {
            name: 'week',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 22 },
          },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['REG', 'POST'], default: 'REG' },
          },
        ],
        responses: {
          '200': {
            description: 'A deterministic cursor-paginated weekly leaderboard.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsWeeklyLeaderboardResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/stats/recent': {
      get: {
        operationId: 'getRecentPlayerPerformance',
        summary: 'Get one playerâ€™s recent recorded performances',
        tags: ['Stats Hub'],
        description:
          'Returns up to the requested number of recorded appearances in chronological order. Null values remain null and are excluded from aggregate calculations; byes and non-appearances are not synthesized. This endpoint provides no prediction or trend claim.',
        parameters: [
          {
            name: 'playerId',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'metric',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: statsMetricIds },
          },
          {
            name: 'season',
            in: 'query',
            schema: { type: 'integer', minimum: 1920, maximum: 2100 },
          },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['REG', 'POST'] },
          },
          {
            name: 'games',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
          },
        ],
        responses: {
          '200': {
            description: 'One playerâ€™s bounded recent-performance summary.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsRecentResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/players': {
      get: {
        operationId: 'listPlayers',
        summary: 'List historical NFL players',
        tags: ['Players'],
        description:
          'Reads normalized player identity data from PostgreSQL. Provider identifiers and import metadata are private.',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 100 } },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'position', in: 'query', schema: { type: 'string', maxLength: 16 } },
          {
            name: 'season',
            in: 'query',
            schema: { type: 'integer', minimum: 2020, maximum: 2025 },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Bounded player page with dataset-level attribution.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PlayerListResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/players/{playerId}': {
      get: {
        operationId: 'getPlayer',
        summary: 'Get a historical NFL player',
        tags: ['Players'],
        parameters: [
          {
            name: 'playerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Normalized player profile.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PlayerResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/players/{playerId}/stats': {
      get: {
        operationId: 'getPlayerStats',
        summary: 'List a player’s weekly game statistics',
        tags: ['Players'],
        parameters: [
          {
            name: 'playerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'season',
            in: 'query',
            schema: { type: 'integer', minimum: 2020, maximum: 2025 },
          },
          { name: 'week', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 22 } },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Selected normalized weekly statistics. Null means missing, not zero.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PlayerStatsResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/players/{playerId}/seasons': {
      get: {
        operationId: 'getPlayerSeasons',
        summary: 'List deterministically derived player season summaries',
        tags: ['Players'],
        parameters: [
          {
            name: 'playerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Derived REG, POST, and REG_POST summaries.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlayerSeasonsResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/teams': {
      get: {
        operationId: 'listTeams',
        summary: 'List active NFL teams',
        description:
          'Returns normalized active NFL teams ordered by conference, division, and full name.',
        tags: ['Teams'],
        responses: {
          '200': {
            description: 'The active NFL team catalog.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TeamListResponse' },
              },
            },
          },
          '429': {
            description: 'The request rate limit was exceeded.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/admin/teams/{teamId}/homepage': {
      get: adminTeamHomepageOperation(
        'getAdminTeamHomepage',
        'Get the composed Team Homepage CMS state',
        [teamHomepageTeamIdParameter],
      ),
    },
    '/admin/teams/{teamId}/homepage/banner': {
      put: adminTeamHomepageOperation(
        'updateTeamHomepageBanner',
        'Set, replace, clear, or position a team banner image',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/UpdateTeamHomepageBannerRequest' },
      ),
    },
    '/admin/teams/{teamId}/homepage/editorial': {
      get: adminTeamHomepageOperation(
        'listTeamHomepageEditorial',
        'List team editorial placements',
        [teamHomepageTeamIdParameter],
      ),
      post: adminTeamHomepageOperation(
        'addTeamHomepageEditorial',
        'Add an article or video editorial placement',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/AddTeamHomepageEditorialRequest' },
        '201',
      ),
    },
    '/admin/teams/{teamId}/homepage/editorial-candidates': {
      get: adminTeamHomepageOperation(
        'listTeamHomepageEditorialCandidates',
        'List bounded team-related article and stored-media candidates',
        [
          teamHomepageTeamIdParameter,
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
      ),
    },
    '/admin/teams/{teamId}/homepage/editorial/order': {
      put: adminTeamHomepageOperation(
        'reorderTeamHomepageEditorial',
        'Reorder all team editorial placements',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/ReorderTeamHomepagePlacementsRequest' },
      ),
    },
    '/admin/teams/{teamId}/homepage/editorial/{placementId}': {
      put: adminTeamHomepageOperation(
        'updateTeamHomepageEditorial',
        'Atomically set or clear a lead-replacement video',
        [teamHomepageTeamIdParameter, teamHomepagePlacementIdParameter],
        { $ref: '#/components/schemas/UpdateTeamHomepageEditorialRequest' },
      ),
      delete: adminTeamHomepageOperation(
        'removeTeamHomepageEditorial',
        'Remove a team editorial placement',
        [teamHomepageTeamIdParameter, teamHomepagePlacementIdParameter],
        undefined,
        '204',
      ),
    },
    '/admin/teams/{teamId}/homepage/highlights': {
      get: adminTeamHomepageOperation(
        'listTeamHomepageHighlights',
        'List team highlight placements and settings',
        [teamHomepageTeamIdParameter],
      ),
      post: adminTeamHomepageOperation(
        'addTeamHomepageHighlight',
        'Add a team-scoped stored-media highlight',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/AddTeamHomepageHighlightRequest' },
        '201',
      ),
    },
    '/admin/teams/{teamId}/homepage/highlight-candidates': {
      get: adminTeamHomepageOperation(
        'listTeamHomepageHighlightCandidates',
        'List bounded team-scoped stored-media candidates',
        [
          teamHomepageTeamIdParameter,
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
          },
          { name: 'cursor', in: 'query', schema: { type: 'integer', minimum: 0 } },
        ],
      ),
    },
    '/admin/teams/{teamId}/homepage/highlights/order': {
      put: adminTeamHomepageOperation(
        'reorderTeamHomepageHighlights',
        'Reorder all curated team highlights',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/ReorderTeamHomepagePlacementsRequest' },
      ),
    },
    '/admin/teams/{teamId}/homepage/highlights/settings': {
      put: adminTeamHomepageOperation(
        'updateTeamHomepageHighlightSettings',
        'Update team highlight display limit and automatic fill',
        [teamHomepageTeamIdParameter],
        { $ref: '#/components/schemas/UpdateTeamHomepageHighlightSettingsRequest' },
      ),
    },
    '/admin/teams/{teamId}/homepage/highlights/{placementId}': {
      delete: adminTeamHomepageOperation(
        'removeTeamHomepageHighlight',
        'Remove a curated team highlight placement',
        [teamHomepageTeamIdParameter, teamHomepagePlacementIdParameter],
        undefined,
        '204',
      ),
    },
    '/teams/{teamId}/hub': {
      get: {
        operationId: 'getTeamHubOverview',
        summary: 'Get a compact public Team Hub overview',
        tags: ['Team Hub', 'Teams'],
        description:
          'Composes the existing public team, game, and article contracts with factual 2020-2025 historical coverage. Upcoming games are SCHEDULED or PREGAME 2026 records ordered by kickoff with official TBD times last; recent games are FINAL records ordered newest first. No current roster or player-stat data is inferred.',
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            description: 'Application-owned active NFL team UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'A cacheable Team Hub overview.',
            headers: { 'Cache-Control': { schema: { type: 'string' } } },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TeamHubResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/teams/{teamId}/roster': {
      get: {
        operationId: 'getHistoricalTeamRoster',
        summary: 'Get a historical weekly-roster-derived team roster',
        tags: ['Team Hub', 'Teams'],
        description:
          'Returns one row per internal player who has at least one stored weekly roster record for the selected team and season. This does not assert full-season, final, or current roster membership. latestKnownTeam is separately labeled and is not current-season proof.',
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'season',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1920, maximum: 2100 },
          },
          {
            name: 'position',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['DB', 'DL', 'K', 'LB', 'LS', 'OL', 'P', 'QB', 'RB', 'TE', 'WR'],
            },
          },
          {
            name: 'positionGroup',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['DB', 'DL', 'LB', 'OL', 'QB', 'RB', 'SPEC', 'TE', 'WR'],
            },
          },
          { name: 'search', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 100 } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          {
            name: 'cursor',
            in: 'query',
            description: 'Opaque cursor bound to the team, season, and roster filters.',
            schema: { type: 'string', maxLength: 1024 },
          },
        ],
        responses: {
          '200': {
            description: 'A deterministic cursor-paginated historical roster.',
            headers: { 'Cache-Control': { schema: { type: 'string' } } },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/TeamRosterResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/teams/{teamId}/stat-leaders': {
      get: {
        operationId: 'getTeamStatLeaders',
        summary: 'Get a historical team-scoped player leaderboard',
        tags: ['Team Hub', 'Stats Hub', 'Teams'],
        description:
          'Uses the exact Stats Hub season-leader metric registry, team-only aggregation, competition ranking, null-versus-zero behavior, tie ordering, and opaque cursor contract. The path team UUID cannot be overridden by query input.',
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          ...statsSharedLeaderboardParameters.filter(({ name }) => name !== 'teamId'),
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['REG', 'POST', 'REG_POST'], default: 'REG' },
          },
        ],
        responses: {
          '200': {
            description: 'The existing Stats Hub season leaderboard contract, scoped to this team.',
            headers: { 'Cache-Control': { schema: { type: 'string' } } },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsSeasonLeaderboardResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/teams/{teamId}': {
      get: {
        operationId: 'getTeamById',
        summary: 'Get one active NFL team',
        tags: ['Teams'],
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            description: 'The application-owned team UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'The normalized active NFL team.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TeamResponse' },
              },
            },
          },
          '400': {
            description: 'The team ID is invalid.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'The active team was not found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '429': {
            description: 'The request rate limit was exceeded.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/games': {
      get: {
        operationId: 'listGames',
        summary: 'List normalized NFL games',
        tags: ['Games'],
        description:
          'Public endpoint. Without an explicit season, results are restricted to the configured current NFL season; an unfiltered request also uses a bounded upcoming 14-day window. Explicit historical seasons remain queryable. Explicit date ranges use UTC, require both bounds, and may not exceed 31 days.',
        parameters: [
          ...gameListQueryParameters,
          {
            name: 'teamId',
            in: 'query',
            description: 'Application-owned team UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'A stable start-time-ordered page of games.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GameListResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': {
            description: 'The supplied team filter does not identify an active team.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/games/{gameId}': {
      get: {
        operationId: 'getGameById',
        summary: 'Get one normalized NFL game',
        tags: ['Games'],
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            description: 'Application-owned game UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'The normalized game.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GameResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': {
            description: 'The game was not found.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/games/{gameId}/stats': {
      get: {
        operationId: 'getCurrentGameStats',
        summary: 'Get one current-game team and player box score',
        tags: ['Games'],
        description:
          'Returns provider-neutral, game-only team totals, scoring by period, safely reconciled player categories, and neutral coverage from PostgreSQL. Unresolved player rows are omitted. Provider identifiers, reconciliation evidence, and source metadata are private.',
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            description: 'Application-owned game UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'The current-game team and safely resolved player box score.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CurrentGameStatsResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': {
            description: 'The game or its current-game statistics were not found.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/games/current-stats': {
      get: {
        operationId: 'listCurrentGameStats',
        summary: 'List current-season games with batched team-stat coverage',
        tags: ['Games'],
        description:
          'Returns one bounded current-season context with resolved public games, provider-neutral home/away team statistics where stored, coverage classifications, and backend-derived availability. It avoids per-game client fan-out and does not expose provider identities or aggregate league rankings.',
        parameters: [
          {
            name: 'season',
            in: 'query',
            schema: { type: 'integer', minimum: 1920, maximum: 2100 },
          },
          {
            name: 'seasonType',
            in: 'query',
            schema: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          },
          {
            name: 'week',
            in: 'query',
            schema: {
              oneOf: [
                { type: 'integer', minimum: 1, maximum: 22 },
                { type: 'string', enum: ['ALL'] },
              ],
            },
          },
          { name: 'teamId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'One current-season game-stat context and availability metadata.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CurrentGameStatsListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/games/{gameId}/plays': {
      get: {
        operationId: 'getCurrentGamePlays',
        summary: 'Get structured play-by-play for one completed game',
        tags: ['Games'],
        description:
          'Returns provider-neutral, oldest-to-newest structured plays stored in PostgreSQL. Provider identifiers, identity hashes, raw payloads, and reconciliation metadata are private. An empty list means play-by-play has not been imported.',
        parameters: [
          {
            name: 'gameId',
            in: 'path',
            required: true,
            description: 'Application-owned game UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'The stored structured play sequence, which may be empty.',
            headers: {
              'Cache-Control': {
                schema: { type: 'string' },
                description: 'Completed-game cache policy with bounded revalidation.',
              },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GamePlaysResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
    '/teams/{teamId}/games': {
      get: {
        operationId: 'listTeamGames',
        summary: 'List games for one active NFL team',
        tags: ['Games', 'Teams'],
        parameters: [
          {
            name: 'teamId',
            in: 'path',
            required: true,
            description: 'Application-owned team UUID.',
            schema: { type: 'string', format: 'uuid' },
          },
          ...gameListQueryParameters,
        ],
        responses: {
          '200': {
            description: 'A page of home and away games for the team.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GameListResponse' } },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': {
            description: 'The active team was not found.',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
          '429': { $ref: '#/components/responses/RateLimitError' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    responses: {
      ValidationError: {
        description: 'The request is invalid.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      UnauthorizedError: {
        description: 'Authentication failed.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      ForbiddenError: {
        description: 'The authenticated account lacks the required administrative capability.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      ConflictError: {
        description: 'The requested resource conflicts with an existing resource.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      NotFoundError: {
        description: 'The requested resource was not found.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      RateLimitError: {
        description: 'The request rate limit was exceeded.',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['status', 'timestamp', 'uptimeSeconds'],
            properties: {
              status: { type: 'string', const: 'ok' },
              timestamp: { type: 'string', format: 'date-time' },
              uptimeSeconds: { type: 'number', minimum: 0 },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'requestId'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              requestId: { type: 'string' },
            },
          },
        },
      },
      NflverseAttribution: {
        type: 'object',
        required: ['source', 'license', 'url'],
        properties: {
          source: { type: 'string', const: 'nflverse' },
          license: { type: 'string', const: 'CC BY 4.0' },
          url: { type: 'string', format: 'uri' },
        },
      },
      StatsMetricId: { type: 'string', enum: statsMetricIds },
      StatsMetric: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'label',
          'shortLabel',
          'description',
          'category',
          'valueType',
          'sortDirection',
          'higherIsBetter',
          'decimalPlaces',
          'nullableBehavior',
          'qualification',
        ],
        properties: {
          id: { $ref: '#/components/schemas/StatsMetricId' },
          label: { type: 'string' },
          shortLabel: { type: 'string' },
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['PASSING', 'RUSHING', 'RECEIVING', 'DEFENSE', 'KICKING'],
          },
          valueType: { type: 'string', enum: ['INTEGER', 'DECIMAL'] },
          sortDirection: { type: 'string', const: 'DESC' },
          higherIsBetter: { type: 'boolean', const: true },
          decimalPlaces: { type: 'integer', minimum: 0 },
          nullableBehavior: { type: 'string', const: 'EXCLUDE' },
          qualification: {
            type: 'null',
            description: 'No rate metrics or minimum-volume qualifications are exposed in v1.',
          },
          availableForSeasonLeaders: { type: 'boolean' },
          availableForWeekLeaders: { type: 'boolean' },
          availableForRecentPerformance: { type: 'boolean' },
        },
      },
      StatsPlayerSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'displayName', 'position', 'positionGroup', 'headshotUrl'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          displayName: { type: 'string' },
          position: { type: ['string', 'null'] },
          positionGroup: { type: ['string', 'null'] },
          headshotUrl: { type: ['string', 'null'], format: 'uri' },
        },
      },
      StatsTeamSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'abbreviation', 'fullName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          abbreviation: { type: 'string' },
          fullName: { type: 'string' },
        },
      },
      StatsMetadataResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: [
              'apiVersion',
              'availableSeasons',
              'seasonTypes',
              'categories',
              'metrics',
              'positions',
              'positionGroups',
              'limits',
              'ranking',
              'coverageNotes',
            ],
            properties: {
              apiVersion: { type: 'string', const: '1.0' },
              availableSeasons: {
                type: 'array',
                items: { type: 'integer' },
                example: [2020, 2021, 2022, 2023, 2024, 2025],
              },
              seasonTypes: { type: 'object' },
              categories: { type: 'array', items: { type: 'object' } },
              metrics: { type: 'array', items: { $ref: '#/components/schemas/StatsMetric' } },
              positions: { type: 'array', items: { type: 'string' } },
              positionGroups: { type: 'array', items: { type: 'string' } },
              limits: { type: 'object' },
              ranking: { type: 'object' },
              coverageNotes: { type: 'array', items: { type: 'string' } },
            },
          },
          meta: {
            type: 'object',
            required: ['attribution'],
            properties: { attribution: { $ref: '#/components/schemas/NflverseAttribution' } },
          },
        },
      },
      StatsSeasonLeader: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rank',
          'tied',
          'player',
          'metricValue',
          'games',
          'season',
          'seasonType',
          'teamContext',
          'qualifyingContext',
        ],
        properties: {
          rank: { type: 'integer', minimum: 1 },
          tied: { type: 'boolean' },
          player: { $ref: '#/components/schemas/StatsPlayerSummary' },
          metricValue: { type: 'number' },
          games: { type: 'integer', minimum: 0 },
          season: { type: 'integer' },
          seasonType: { type: 'string', enum: ['REG', 'POST', 'REG_POST'] },
          teamContext: {
            type: 'object',
            required: ['type', 'teams'],
            properties: {
              type: { type: 'string', enum: ['NONE', 'SINGLE', 'MULTI'] },
              teams: {
                type: 'array',
                items: { $ref: '#/components/schemas/StatsTeamSummary' },
              },
            },
          },
          qualifyingContext: { type: 'null' },
        },
      },
      StatsWeeklyLeader: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rank',
          'tied',
          'player',
          'metricValue',
          'games',
          'season',
          'seasonType',
          'week',
          'gameId',
          'gameDate',
          'team',
          'opponent',
          'qualifyingContext',
        ],
        properties: {
          rank: { type: 'integer', minimum: 1 },
          tied: { type: 'boolean' },
          player: { $ref: '#/components/schemas/StatsPlayerSummary' },
          metricValue: { type: 'number' },
          games: { type: 'integer', const: 1 },
          season: { type: 'integer' },
          seasonType: { type: 'string', enum: ['REG', 'POST'] },
          week: { type: 'integer', minimum: 1, maximum: 22 },
          gameId: { type: 'string', format: 'uuid' },
          gameDate: { type: ['string', 'null'], format: 'date-time' },
          team: { $ref: '#/components/schemas/StatsTeamSummary' },
          opponent: { $ref: '#/components/schemas/StatsTeamSummary' },
          qualifyingContext: { type: 'null' },
        },
      },
      StatsLeaderboardMeta: {
        type: 'object',
        required: ['nextCursor', 'metric', 'ranking', 'attribution'],
        properties: {
          nextCursor: { type: ['string', 'null'] },
          metric: { $ref: '#/components/schemas/StatsMetric' },
          ranking: { type: 'object' },
          attribution: { $ref: '#/components/schemas/NflverseAttribution' },
        },
      },
      StatsSeasonLeaderboardResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/StatsSeasonLeader' },
          },
          meta: { $ref: '#/components/schemas/StatsLeaderboardMeta' },
        },
      },
      StatsWeeklyLeaderboardResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/StatsWeeklyLeader' },
          },
          meta: { $ref: '#/components/schemas/StatsLeaderboardMeta' },
        },
      },
      StatsRecentPerformance: {
        type: 'object',
        additionalProperties: false,
        required: [
          'gameId',
          'season',
          'seasonType',
          'week',
          'gameDate',
          'team',
          'opponent',
          'value',
        ],
        properties: {
          gameId: { type: 'string', format: 'uuid' },
          season: { type: 'integer' },
          seasonType: { type: 'string', enum: ['REG', 'POST'] },
          week: { type: 'integer', minimum: 1, maximum: 22 },
          gameDate: { type: ['string', 'null'], format: 'date-time' },
          team: { $ref: '#/components/schemas/StatsTeamSummary' },
          opponent: { $ref: '#/components/schemas/StatsTeamSummary' },
          value: { type: ['number', 'null'] },
        },
      },
      StatsRecentResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['player', 'performances', 'summary'],
            properties: {
              player: { $ref: '#/components/schemas/StatsPlayerSummary' },
              performances: {
                type: 'array',
                maxItems: 20,
                items: { $ref: '#/components/schemas/StatsRecentPerformance' },
              },
              summary: {
                type: 'object',
                required: [
                  'gamesRepresented',
                  'valuesRepresented',
                  'missingDataCount',
                  'average',
                  'total',
                  'minimum',
                  'maximum',
                ],
                properties: {
                  gamesRepresented: { type: 'integer', minimum: 0 },
                  valuesRepresented: { type: 'integer', minimum: 0 },
                  missingDataCount: { type: 'integer', minimum: 0 },
                  average: { type: ['number', 'null'] },
                  total: { type: ['number', 'null'] },
                  minimum: { type: ['number', 'null'] },
                  maximum: { type: ['number', 'null'] },
                },
              },
            },
          },
          meta: {
            type: 'object',
            required: ['metric', 'attribution'],
            properties: {
              metric: { $ref: '#/components/schemas/StatsMetric' },
              attribution: { $ref: '#/components/schemas/NflverseAttribution' },
            },
          },
        },
      },
      Player: {
        type: 'object',
        required: [
          'id',
          'displayName',
          'position',
          'positionGroup',
          'birthDate',
          'heightInches',
          'weightPounds',
          'college',
          'draft',
          'latestTeam',
          'jerseyNumber',
          'status',
          'headshotUrl',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          displayName: { type: 'string' },
          firstName: { type: ['string', 'null'] },
          lastName: { type: ['string', 'null'] },
          shortName: { type: ['string', 'null'] },
          position: { type: ['string', 'null'] },
          positionGroup: { type: ['string', 'null'] },
          birthDate: { type: ['string', 'null'], format: 'date' },
          heightInches: { type: ['integer', 'null'] },
          weightPounds: { type: ['integer', 'null'] },
          college: { type: ['string', 'null'] },
          rookieSeason: { type: ['integer', 'null'] },
          lastSeason: { type: ['integer', 'null'] },
          draft: { type: ['object', 'null'] },
          latestTeam: { type: ['object', 'null'] },
          jerseyNumber: { type: ['integer', 'null'] },
          status: { type: ['string', 'null'] },
          headshotUrl: { type: ['string', 'null'], format: 'uri' },
        },
      },
      PlayerListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Player' } },
          meta: {
            type: 'object',
            required: ['nextCursor', 'attribution'],
            properties: {
              nextCursor: { type: ['string', 'null'], format: 'uuid' },
              attribution: { $ref: '#/components/schemas/NflverseAttribution' },
            },
          },
        },
      },
      PlayerResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { $ref: '#/components/schemas/Player' },
          meta: {
            type: 'object',
            required: ['attribution'],
            properties: { attribution: { $ref: '#/components/schemas/NflverseAttribution' } },
          },
        },
      },
      PlayerGameStat: {
        type: 'object',
        required: [
          'id',
          'gameId',
          'season',
          'week',
          'seasonType',
          'team',
          'opponent',
          'passing',
          'rushing',
          'receiving',
          'defense',
          'kicking',
          'returns',
          'fantasy',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          gameId: { type: 'string', format: 'uuid' },
          season: { type: 'integer' },
          week: { type: 'integer' },
          seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          startTime: { type: ['string', 'null'], format: 'date-time' },
          team: { type: 'object' },
          opponent: { type: 'object' },
          position: { type: ['string', 'null'] },
          positionGroup: { type: ['string', 'null'] },
          passing: { type: 'object' },
          rushing: { type: 'object' },
          receiving: { type: 'object' },
          defense: { type: 'object' },
          kicking: { type: 'object' },
          returns: { type: 'object' },
          fantasy: { type: 'object' },
        },
      },
      PlayerStatsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/PlayerGameStat' } },
          meta: {
            type: 'object',
            required: ['nextCursor', 'attribution'],
            properties: {
              nextCursor: { type: ['string', 'null'], format: 'uuid' },
              attribution: { $ref: '#/components/schemas/NflverseAttribution' },
            },
          },
        },
      },
      PlayerSeasonStat: {
        type: 'object',
        required: [
          'id',
          'season',
          'summaryType',
          'games',
          'teamCount',
          'passing',
          'rushing',
          'receiving',
          'defense',
          'kicking',
          'fantasy',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          season: { type: 'integer' },
          summaryType: { type: 'string', enum: ['REG', 'POST', 'REG_POST'] },
          games: { type: 'integer' },
          teamCount: { type: 'integer' },
          passing: { type: 'object' },
          rushing: { type: 'object' },
          receiving: { type: 'object' },
          defense: { type: 'object' },
          kicking: { type: 'object' },
          fantasy: { type: 'object' },
        },
      },
      PlayerSeasonsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/PlayerSeasonStat' } },
          meta: {
            type: 'object',
            required: ['attribution'],
            properties: { attribution: { $ref: '#/components/schemas/NflverseAttribution' } },
          },
        },
      },
      NewsSourceKind: { type: 'string', enum: ['RSS', 'ATOM', 'MANUAL_ONLY'] },
      NewsContentType: {
        type: 'string',
        enum: ['ARTICLE', 'VIDEO', 'HIGHLIGHT'],
        description:
          'Set once per source at creation, not classified per-item or by AI. Copied onto every candidate the source produces.',
      },
      NewsSourceStatus: {
        type: 'string',
        enum: ['ACTIVE', 'PAUSED', 'DISABLED', 'ERROR'],
      },
      NewsCandidateStatus: {
        type: 'string',
        enum: ['NEW', 'REVIEWING', 'SAVED', 'CONVERTED', 'DISMISSED'],
      },
      NewsSource: {
        type: 'object',
        required: [
          'id',
          'name',
          'slug',
          'kind',
          'contentType',
          'status',
          'feedUrl',
          'siteUrl',
          'publisherName',
          'defaultTeam',
          'isOfficialLeague',
          'isOfficialTeam',
          'allowsDescriptionUse',
          'sourcePreference',
          'notes',
          'health',
          'createdBySnapshot',
          'updatedBySnapshot',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', maxLength: 160 },
          slug: { type: 'string', maxLength: 96 },
          kind: { $ref: '#/components/schemas/NewsSourceKind' },
          contentType: { $ref: '#/components/schemas/NewsContentType' },
          status: { $ref: '#/components/schemas/NewsSourceStatus' },
          feedUrl: { type: ['string', 'null'], format: 'uri' },
          siteUrl: { type: 'string', format: 'uri' },
          publisherName: { type: 'string', maxLength: 160 },
          defaultTeam: { oneOf: [{ $ref: '#/components/schemas/ArticleTeam' }, { type: 'null' }] },
          isOfficialLeague: { type: 'boolean' },
          isOfficialTeam: { type: 'boolean' },
          allowsDescriptionUse: { type: 'boolean' },
          sourcePreference: {
            type: 'object',
            properties: {
              reliability: { type: 'integer', minimum: 0, maximum: 100 },
              metadataRichness: { type: 'integer', minimum: 0, maximum: 100 },
              teamSpecificity: { type: 'integer', minimum: 0, maximum: 100 },
              editorialUsefulness: { type: 'integer', minimum: 0, maximum: 100 },
            },
          },
          notes: { type: ['string', 'null'], maxLength: 1000 },
          health: {
            type: 'object',
            required: [
              'lastCheckedAt',
              'lastSuccessfulAt',
              'lastErrorCode',
              'lastErrorSummary',
              'lastItemCount',
              'consecutiveFailureCount',
              'hasEtag',
              'hasModifiedValidator',
              'runActive',
            ],
            properties: {
              lastCheckedAt: { type: ['string', 'null'], format: 'date-time' },
              lastSuccessfulAt: { type: ['string', 'null'], format: 'date-time' },
              lastErrorCode: { type: ['string', 'null'] },
              lastErrorSummary: { type: ['string', 'null'] },
              lastItemCount: { type: 'integer', minimum: 0 },
              consecutiveFailureCount: { type: 'integer', minimum: 0 },
              hasEtag: { type: 'boolean' },
              hasModifiedValidator: { type: 'boolean' },
              runActive: { type: 'boolean' },
            },
          },
          createdBySnapshot: { type: 'string' },
          updatedBySnapshot: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      NewsSourceCreateRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'slug', 'kind', 'feedUrl', 'siteUrl', 'publisherName'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 160 },
          slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 96 },
          kind: { $ref: '#/components/schemas/NewsSourceKind' },
          contentType: {
            allOf: [{ $ref: '#/components/schemas/NewsContentType' }],
            default: 'ARTICLE',
          },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'DISABLED'], default: 'PAUSED' },
          feedUrl: { type: ['string', 'null'], format: 'uri' },
          siteUrl: { type: 'string', format: 'uri' },
          publisherName: { type: 'string', maxLength: 160 },
          defaultTeamId: { type: ['string', 'null'], format: 'uuid' },
          isOfficialLeague: { type: 'boolean', default: false },
          isOfficialTeam: { type: 'boolean', default: false },
          allowsDescriptionUse: { type: 'boolean', default: false },
          reliabilityWeight: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          metadataRichnessWeight: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          teamSpecificityWeight: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          editorialUsefulnessWeight: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          notes: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      NewsSourceUpdateRequest: {
        description:
          'Partial source update. At least one field is required; relationship rules are revalidated.',
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 160 },
          slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 96 },
          kind: { $ref: '#/components/schemas/NewsSourceKind' },
          contentType: { $ref: '#/components/schemas/NewsContentType' },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'DISABLED'] },
          feedUrl: { type: ['string', 'null'], format: 'uri' },
          siteUrl: { type: 'string', format: 'uri' },
          publisherName: { type: 'string', maxLength: 160 },
          defaultTeamId: { type: ['string', 'null'], format: 'uuid' },
          isOfficialLeague: { type: 'boolean' },
          isOfficialTeam: { type: 'boolean' },
          allowsDescriptionUse: { type: 'boolean' },
          reliabilityWeight: { type: 'integer', minimum: 0, maximum: 100 },
          metadataRichnessWeight: { type: 'integer', minimum: 0, maximum: 100 },
          teamSpecificityWeight: { type: 'integer', minimum: 0, maximum: 100 },
          editorialUsefulnessWeight: { type: 'integer', minimum: 0, maximum: 100 },
          notes: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      NewsSourceResponse: {
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: '#/components/schemas/NewsSource' } },
      },
      NewsSourceListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/NewsSource' } },
          meta: { $ref: '#/components/schemas/CursorMeta' },
        },
      },
      NewsIngestionRun: {
        type: 'object',
        required: [
          'id',
          'sourceId',
          'status',
          'startedAt',
          'completedAt',
          'fetchedCount',
          'createdCount',
          'updatedCount',
          'skippedCount',
          'failedCount',
          'responseBytes',
          'hasResponseEtag',
          'hasResponseModified',
          'errorCode',
          'errorSummary',
          'initiatedBySnapshot',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sourceId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'] },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: ['string', 'null'], format: 'date-time' },
          fetchedCount: { type: 'integer', minimum: 0 },
          createdCount: { type: 'integer', minimum: 0 },
          updatedCount: { type: 'integer', minimum: 0 },
          skippedCount: { type: 'integer', minimum: 0 },
          failedCount: { type: 'integer', minimum: 0 },
          responseBytes: { type: ['integer', 'null'], minimum: 0 },
          hasResponseEtag: { type: 'boolean' },
          hasResponseModified: { type: 'boolean' },
          errorCode: { type: ['string', 'null'] },
          errorSummary: { type: ['string', 'null'] },
          initiatedBySnapshot: { type: 'string' },
        },
      },
      NewsSourceDetailResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['source', 'recentRuns'],
            properties: {
              source: { $ref: '#/components/schemas/NewsSource' },
              recentRuns: {
                type: 'array',
                maxItems: 20,
                items: { $ref: '#/components/schemas/NewsIngestionRun' },
              },
            },
          },
        },
      },
      NewsCandidate: {
        type: 'object',
        required: [
          'id',
          'source',
          'sourceName',
          'canonicalUrl',
          'headline',
          'sourceAuthor',
          'contentType',
          'thumbnailUrl',
          'sourcePublishedAt',
          'discoveredAt',
          'status',
          'convertedArticleId',
          'quality',
          'suggestedTeams',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          source: { type: ['object', 'null'] },
          sourceName: { type: 'string', maxLength: 160 },
          canonicalUrl: { type: 'string', format: 'uri' },
          headline: { type: 'string', maxLength: 300 },
          sourceAuthor: { type: ['string', 'null'], maxLength: 160 },
          contentType: { $ref: '#/components/schemas/NewsContentType' },
          thumbnailUrl: {
            type: ['string', 'null'],
            format: 'uri',
            description:
              'Feed-provided thumbnail image only, never a direct video/audio file. Use canonicalUrl for the video/highlight page.',
          },
          sourcePublishedAt: { type: ['string', 'null'], format: 'date-time' },
          discoveredAt: { type: 'string', format: 'date-time' },
          status: { $ref: '#/components/schemas/NewsCandidateStatus' },
          convertedArticleId: { type: ['string', 'null'], format: 'uuid' },
          quality: {
            type: ['object', 'null'],
            description: 'Private persisted candidate-quality summary for administrative routes.',
          },
          suggestedTeams: { type: 'array', maxItems: 32, items: { type: 'object' } },
          sourceExternalId: { type: ['string', 'null'], maxLength: 512 },
          sourceDescription: { type: ['string', 'null'], maxLength: 2000 },
          dismissalReason: { type: ['string', 'null'], maxLength: 500 },
          qualityDetail: {
            type: ['object', 'null'],
            description:
              'Private factors, reasons, overlap, and override metadata on detail reads.',
          },
          reviewedBySnapshot: { type: ['string', 'null'] },
          reviewedAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      NewsCandidateResponse: {
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: '#/components/schemas/NewsCandidate' } },
      },
      NewsCandidateListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/NewsCandidate' } },
          meta: { $ref: '#/components/schemas/CursorMeta' },
        },
      },
      ManualNewsCandidateRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'headline', 'sourceName'],
        properties: {
          url: { type: 'string', format: 'uri' },
          headline: { type: 'string', minLength: 1, maxLength: 300 },
          sourceName: { type: 'string', minLength: 1, maxLength: 160 },
          sourceId: { type: ['string', 'null'], format: 'uuid' },
          sourceDescription: { type: ['string', 'null'], maxLength: 2000 },
          sourceAuthor: { type: ['string', 'null'], maxLength: 160 },
          sourcePublishedAt: { type: ['string', 'null'], format: 'date-time' },
          suggestedTeamIds: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', format: 'uuid' },
          },
        },
      },
      NewsCandidateDismissRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      NewsCandidateConvertRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'originalSummary'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 180 },
          slug: { type: 'string', minLength: 1, maxLength: 160 },
          originalSummary: { type: 'string', minLength: 1, maxLength: 1000 },
          originalCommentary: {
            type: ['string', 'null'],
            maxLength: 2000,
            description: 'Original Markdown only.',
          },
          confirmedTeamIds: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', format: 'uuid' },
          },
          heroImageUrl: { type: ['string', 'null'], format: 'uri' },
          heroImageAlt: { type: ['string', 'null'], maxLength: 300 },
          heroImageAttribution: { type: ['string', 'null'], maxLength: 500 },
          heroImageAttributionUrl: { type: ['string', 'null'], format: 'uri' },
          changeSummary: { type: ['string', 'null'], maxLength: 500 },
        },
      },
      NewsIngestionResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['sourceId', 'sourceSlug', 'testedOnly', 'notModified', 'feedKind', 'run'],
            properties: {
              sourceId: { type: 'string', format: 'uuid' },
              sourceSlug: { type: 'string' },
              testedOnly: { type: 'boolean' },
              notModified: { type: 'boolean' },
              feedKind: { type: ['string', 'null'], enum: ['RSS', 'ATOM', null] },
              run: { $ref: '#/components/schemas/NewsIngestionRun' },
            },
          },
        },
      },
      NewsCandidateConversionResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['candidate', 'article'],
            properties: {
              candidate: { $ref: '#/components/schemas/NewsCandidate' },
              article: { $ref: '#/components/schemas/AdminArticleDetail' },
            },
          },
        },
      },
      EditorialAiGenerateRequest: {
        type: 'object',
        additionalProperties: false,
        properties: { instruction: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      EditorialAiBatchRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateIds'],
        properties: {
          candidateIds: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
        },
      },
      EditorialAiDraftResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: [
              'article',
              'reviewStatus',
              'candidateId',
              'confidence',
              'riskFlags',
              'overlap',
              'mediaSearchTerms',
              'ai',
              'performance',
            ],
            properties: {
              article: {
                type: 'object',
                description: 'Always a private DRAFT; generation never publishes.',
              },
              reviewStatus: { type: 'string', enum: ['NEEDS_REVIEW'] },
              candidateId: { type: 'string', format: 'uuid' },
              primaryTeamId: { type: ['string', 'null'], format: 'uuid' },
              additionalTeamIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
              playerIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
              unresolvedPlayers: { type: 'array', items: { type: 'object' } },
              category: { type: 'string' },
              topicTags: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
              riskFlags: { type: 'array', items: { type: 'string' } },
              overlap: { type: 'object' },
              sourceOverlapScore: { type: 'number', minimum: 0, maximum: 1 },
              mediaSearchTerms: { type: 'array', items: { type: 'string' } },
              attribution: { type: 'string' },
              ai: { type: 'object', description: 'Private provider/model/version/usage metadata.' },
              performance: { type: 'object' },
            },
          },
        },
      },
      CandidateQualityBatchRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateIds'],
        properties: {
          candidateIds: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
        },
      },
      CandidateQualityOverrideRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['relevance', 'sufficiency', 'reason'],
        properties: {
          relevance: { type: 'string', enum: ['NFL', 'NOT_NFL', 'UNCERTAIN'] },
          sufficiency: {
            type: 'string',
            enum: [
              'FULL_DRAFT_ELIGIBLE',
              'SHORT_BRIEF_ELIGIBLE',
              'LINK_ONLY',
              'INSUFFICIENT',
              'MANUAL_REVIEW',
            ],
          },
          allowDuplicate: { type: 'boolean', default: false },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      CandidateQualityResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            description:
              'Private evaluation containing interpretable factors, overlap, entity resolution, eligibility, and optional classifier usage.',
          },
        },
      },
      LaunchDiscoveryRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetPerTeam: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          freshnessDays: { type: 'integer', minimum: 1, maximum: 30, default: 14 },
          maxNewCandidates: { type: 'integer', minimum: 1, maximum: 320, default: 320 },
          pilot: { type: 'boolean', default: false },
        },
      },
      EditorialCoverageResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['targetCount', 'teams', 'totals', 'durationMs'],
            properties: {
              targetCount: { type: 'integer' },
              teams: { type: 'array', minItems: 32, maxItems: 32, items: { type: 'object' } },
              totals: { type: 'object' },
              durationMs: { type: 'integer' },
            },
          },
        },
      },
      DataHealthGameListResponse: {
        type: 'object',
        required: ['data', 'summary', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/DataHealthGameRow' } },
          summary: { $ref: '#/components/schemas/DataHealthSummary' },
          meta: {
            type: 'object',
            required: ['nextCursor'],
            properties: { nextCursor: { type: ['string', 'null'] } },
          },
        },
      },
      DataHealthGameRow: {
        type: 'object',
        description:
          'DB-only coverage for one game. Never includes a provider record ID -- providerMapping is presence-only.',
        properties: {
          gameId: { type: 'string', format: 'uuid' },
          season: { type: 'integer' },
          seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          week: { type: ['integer', 'null'] },
          kickoff: { type: ['string', 'null'], format: 'date-time' },
          status: { type: 'string' },
          awayTeam: { type: 'object' },
          homeTeam: { type: 'object' },
          result: {
            type: 'object',
            description: 'state, homeScore, awayScore, source, reasonCode.',
          },
          providerMapping: {
            type: 'object',
            properties: { available: { type: 'boolean' } },
          },
          teamStats: {
            type: 'object',
            description: 'state, rowCount, expectedRowCount, reasonCode.',
          },
          playerStats: { type: 'object', description: 'state, rowCount, playerCount, reasonCode.' },
          plays: { type: 'object', description: 'state, activeCount, reviewRequired.' },
          lastProbe: {
            type: ['object', 'null'],
            description:
              'Cached findings from the most recent explicit probe, if any. Never triggers a new one.',
          },
          needsInvestigation: { type: 'boolean' },
        },
      },
      DataHealthSummary: {
        type: 'object',
        properties: {
          games: { type: 'integer' },
          resultsComplete: { type: 'integer' },
          resultsMissing: { type: 'integer' },
          teamStatsComplete: { type: 'integer' },
          teamStatsMissing: { type: 'integer' },
          playerStatsComplete: { type: 'integer' },
          playerStatsMissing: { type: 'integer' },
          playsAvailable: { type: 'integer' },
          needsInvestigation: { type: 'integer' },
        },
      },
      DataHealthProbeResponse: {
        type: 'object',
        required: ['data'],
        description:
          'Result of one bounded, explicit Highlightly probe. Persists a sanitized GameDataHealthProbe row; never writes production game/stat/play data.',
        properties: {
          data: {
            type: 'object',
            properties: {
              gameId: { type: 'string', format: 'uuid' },
              checkedAt: { type: 'string', format: 'date-time' },
              provider: {
                type: 'object',
                description:
                  'reachable, matchFound, requestCount (always <= 2), durationMs, quotaLimit, quotaRemaining.',
              },
              result: {
                type: 'object',
                description:
                  'providerAvailable, providerStatus, scoreAvailable, diagnosis, explanation.',
              },
              teamStats: {
                type: 'object',
                description:
                  'providerAvailable, rawRows, normalizedRows, databaseRows, diagnosis, explanation.',
              },
              playerStats: {
                type: 'object',
                description:
                  'providerAvailable, rawRows, normalizedRows, resolvedPlayers, unresolvedPlayers (upper bound -- see docs/administration/data-health.md), databaseRows, diagnosis, explanation.',
              },
              plays: {
                type: 'object',
                description:
                  'providerAvailable, rawCount, normalizedCount, databaseActiveCount, diagnosis, explanation.',
              },
            },
          },
        },
      },
      SourceRightsProfileRequest: {
        type: 'object',
        additionalProperties: false,
        required: [
          'textUsage',
          'imageUsage',
          'videoUsage',
          'quotationPolicy',
          'reviewRequired',
          'notes',
        ],
        properties: {
          textUsage: { type: 'string', enum: ['SUMMARY_ALLOWED', 'LINK_ONLY', 'UNKNOWN'] },
          imageUsage: { type: 'string', enum: ['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN'] },
          videoUsage: { type: 'string', enum: ['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN'] },
          quotationPolicy: { type: 'string', enum: ['SHORT_QUOTES_ONLY', 'UNKNOWN'] },
          reviewRequired: { type: 'boolean' },
          notes: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      ArticleMediaCandidateRequest: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'platform',
          'externalId',
          'url',
          'title',
          'publisher',
          'thumbnailUrl',
          'publishedAt',
          'embedAllowed',
          'rightsStatus',
          'relevanceScore',
        ],
        properties: {
          type: { type: 'string', enum: ['YOUTUBE', 'VIDEO_EMBED', 'IMAGE', 'EXTERNAL_LINK'] },
          platform: { type: 'string', maxLength: 64 },
          externalId: { type: ['string', 'null'], maxLength: 256 },
          url: { type: 'string', format: 'uri' },
          title: { type: 'string', maxLength: 300 },
          publisher: { type: ['string', 'null'], maxLength: 160 },
          thumbnailUrl: { type: ['string', 'null'], format: 'uri' },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
          embedAllowed: { type: 'boolean' },
          rightsStatus: {
            type: 'string',
            enum: ['OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN'],
          },
          relevanceScore: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      Team: {
        type: 'object',
        required: [
          'id',
          'league',
          'city',
          'name',
          'fullName',
          'abbreviation',
          'conference',
          'division',
          'primaryColor',
          'secondaryColor',
          'logoUrl',
          'logoSource',
          'isActive',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          league: { type: 'string', enum: ['NFL'] },
          city: { type: 'string' },
          name: { type: 'string' },
          fullName: { type: 'string' },
          abbreviation: { type: 'string' },
          conference: { type: 'string', enum: ['AFC', 'NFC'] },
          division: { type: 'string', enum: ['East', 'North', 'South', 'West'] },
          primaryColor: { type: 'string', pattern: '^#[0-9A-F]{6}$' },
          secondaryColor: { type: 'string', pattern: '^#[0-9A-F]{6}$' },
          logoUrl: { type: ['string', 'null'], format: 'uri' },
          logoSource: { type: ['string', 'null'] },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TeamResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: { $ref: '#/components/schemas/Team' },
        },
      },
      TeamListResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Team' },
          },
        },
      },
      TeamHubSummary: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'abbreviation', 'fullName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          abbreviation: { type: 'string' },
          fullName: { type: 'string' },
        },
      },
      UpdateTeamHomepageBannerRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          imageUrl: { type: ['string', 'null'], format: 'uri', maxLength: 2048 },
          focalX: { type: 'integer', minimum: 0, maximum: 100 },
          focalY: { type: 'integer', minimum: 0, maximum: 100 },
          overlayOpacity: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
      AddTeamHomepageEditorialRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceType', 'sourceId'],
        properties: {
          sourceType: { type: 'string', enum: ['ARTICLE', 'VIDEO'] },
          sourceId: { type: 'string', format: 'uuid' },
          mediaSourceType: {
            type: 'string',
            enum: ['GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO'],
          },
          isLeadReplacement: { type: 'boolean', default: false },
        },
      },
      UpdateTeamHomepageEditorialRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['isLeadReplacement'],
        properties: { isLeadReplacement: { type: 'boolean' } },
      },
      ReorderTeamHomepagePlacementsRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['placementIds'],
        properties: {
          placementIds: {
            type: 'array',
            maxItems: 10,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
        },
      },
      AddTeamHomepageHighlightRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceType', 'sourceId'],
        properties: {
          sourceType: {
            type: 'string',
            enum: ['GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO'],
          },
          sourceId: { type: 'string', format: 'uuid' },
        },
      },
      UpdateTeamHomepageHighlightSettingsRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['displayLimit', 'fillWithAutomatic'],
        properties: {
          displayLimit: { type: 'integer', minimum: 3, maximum: 10, default: 5 },
          fillWithAutomatic: { type: 'boolean', default: true },
        },
      },
      TeamHubResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['team', 'schedule', 'news', 'homepage', 'historicalData'],
            properties: {
              team: { $ref: '#/components/schemas/Team' },
              schedule: {
                type: 'object',
                required: ['season', 'upcoming', 'recent'],
                properties: {
                  season: {
                    type: 'integer',
                    example: 2026,
                    description: 'The configured current NFL season used by public game reads.',
                  },
                  upcoming: {
                    type: 'array',
                    maxItems: 3,
                    items: { $ref: '#/components/schemas/Game' },
                  },
                  recent: {
                    type: 'array',
                    maxItems: 3,
                    items: { $ref: '#/components/schemas/Game' },
                  },
                },
              },
              news: {
                type: 'object',
                required: ['articles'],
                properties: {
                  articles: {
                    type: 'array',
                    maxItems: 3,
                    items: { $ref: '#/components/schemas/PublicArticleListItem' },
                  },
                },
              },
              homepage: { $ref: '#/components/schemas/PublicTeamHomepage' },
              historicalData: {
                type: 'object',
                required: [
                  'defaultSeason',
                  'rosterSeasons',
                  'statSeasons',
                  'positions',
                  'positionGroups',
                  'coverageNotes',
                ],
                properties: {
                  defaultSeason: { type: ['integer', 'null'] },
                  rosterSeasons: { type: 'array', items: { type: 'integer' } },
                  statSeasons: { type: 'array', items: { type: 'integer' } },
                  positions: { type: 'array', items: { type: 'string' } },
                  positionGroups: { type: 'array', items: { type: 'string' } },
                  coverageNotes: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          meta: {
            type: 'object',
            required: ['attribution'],
            properties: { attribution: { $ref: '#/components/schemas/NflverseAttribution' } },
          },
        },
      },
      TeamHomepageBanner: {
        type: 'object',
        additionalProperties: false,
        required: ['imageUrl', 'focalX', 'focalY', 'overlayOpacity'],
        properties: {
          imageUrl: { type: ['string', 'null'], format: 'uri' },
          focalX: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          focalY: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          overlayOpacity: { type: 'integer', minimum: 0, maximum: 100, default: 35 },
        },
      },
      TeamHomepageArticleItem: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'article'],
        properties: {
          type: { type: 'string', enum: ['ARTICLE'] },
          article: { $ref: '#/components/schemas/PublicArticleListItem' },
        },
      },
      TeamHomepageVideoItem: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'id',
          'gameId',
          'title',
          'thumbnailUrl',
          'canonicalUrl',
          'embedUrl',
          'canEmbed',
          'publishedAt',
        ],
        properties: {
          type: { type: 'string', enum: ['VIDEO'] },
          id: { type: 'string', format: 'uuid' },
          gameId: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          thumbnailUrl: { type: ['string', 'null'], format: 'uri' },
          canonicalUrl: { type: ['string', 'null'], format: 'uri' },
          embedUrl: { type: ['string', 'null'], format: 'uri' },
          canEmbed: { type: 'boolean' },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      TeamHomepageEditorialItem: {
        oneOf: [
          { $ref: '#/components/schemas/TeamHomepageArticleItem' },
          { $ref: '#/components/schemas/TeamHomepageVideoItem' },
        ],
        discriminator: { propertyName: 'type' },
      },
      PublicTeamHomepage: {
        type: 'object',
        additionalProperties: false,
        required: ['banner', 'editorial', 'highlights'],
        properties: {
          banner: { $ref: '#/components/schemas/TeamHomepageBanner' },
          editorial: {
            type: 'object',
            required: ['featuredItem', 'supportingItems'],
            properties: {
              featuredItem: {
                oneOf: [
                  { $ref: '#/components/schemas/TeamHomepageEditorialItem' },
                  { type: 'null' },
                ],
              },
              supportingItems: {
                type: 'array',
                maxItems: 8,
                items: { $ref: '#/components/schemas/TeamHomepageEditorialItem' },
              },
            },
          },
          highlights: {
            type: 'array',
            minItems: 0,
            maxItems: 10,
            items: { $ref: '#/components/schemas/TeamHomepageVideoItem' },
          },
        },
      },
      TeamRosterRow: {
        type: 'object',
        additionalProperties: false,
        required: [
          'player',
          'season',
          'historicalTeam',
          'latestKnownTeam',
          'position',
          'positionGroup',
          'jerseyNumber',
          'status',
          'firstWeek',
          'lastWeek',
          'rosterWeekCount',
        ],
        properties: {
          player: {
            type: 'object',
            required: ['id', 'displayName', 'headshotUrl'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              displayName: { type: 'string' },
              headshotUrl: { type: ['string', 'null'], format: 'uri' },
            },
          },
          season: { type: 'integer' },
          historicalTeam: { $ref: '#/components/schemas/TeamHubSummary' },
          latestKnownTeam: {
            oneOf: [{ $ref: '#/components/schemas/TeamHubSummary' }, { type: 'null' }],
          },
          position: { type: ['string', 'null'] },
          positionGroup: { type: ['string', 'null'] },
          jerseyNumber: { type: ['integer', 'null'] },
          status: { type: ['string', 'null'] },
          firstWeek: { type: 'integer', minimum: 1 },
          lastWeek: { type: 'integer', minimum: 1 },
          rosterWeekCount: { type: 'integer', minimum: 1 },
        },
      },
      TeamRosterResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['team', 'season', 'roster'],
            properties: {
              team: { $ref: '#/components/schemas/Team' },
              season: { type: 'integer' },
              roster: { type: 'array', items: { $ref: '#/components/schemas/TeamRosterRow' } },
            },
          },
          meta: {
            type: 'object',
            required: ['nextCursor', 'semantics', 'attribution'],
            properties: {
              nextCursor: { type: ['string', 'null'], maxLength: 1024 },
              semantics: {
                type: 'object',
                required: ['membership', 'firstWeek', 'lastWeek', 'latestKnownTeam'],
                properties: {
                  membership: { type: 'string' },
                  firstWeek: { type: 'string' },
                  lastWeek: { type: 'string' },
                  latestKnownTeam: { type: 'string' },
                },
              },
              attribution: { $ref: '#/components/schemas/NflverseAttribution' },
            },
          },
        },
      },
      GameStatus: {
        type: 'string',
        enum: [
          'SCHEDULED',
          'PREGAME',
          'IN_PROGRESS',
          'HALFTIME',
          'FINAL',
          'POSTPONED',
          'CANCELED',
          'SUSPENDED',
        ],
        description:
          'Provider-independent game state. Provider adapters must map source statuses into this set.',
      },
      GameTeamSummary: {
        type: 'object',
        required: ['id', 'fullName', 'abbreviation', 'logoUrl', 'primaryColor', 'secondaryColor'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          fullName: { type: 'string' },
          abbreviation: { type: 'string' },
          logoUrl: { type: ['string', 'null'], format: 'uri' },
          primaryColor: { type: 'string', pattern: '^#[0-9A-F]{6}$' },
          secondaryColor: { type: 'string', pattern: '^#[0-9A-F]{6}$' },
        },
      },
      Game: {
        type: 'object',
        required: [
          'id',
          'league',
          'season',
          'seasonType',
          'week',
          'startTime',
          'status',
          'homeTeam',
          'awayTeam',
          'homeScore',
          'awayScore',
          'quarter',
          'clock',
          'venue',
          'broadcastNetwork',
          'isNeutralSite',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          league: { type: 'string', enum: ['NFL'] },
          season: { type: 'integer' },
          seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          week: { type: ['integer', 'null'], minimum: 1, maximum: 22 },
          startTime: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'UTC ISO 8601 timestamp, or null while the official kickoff is TBD.',
          },
          status: { $ref: '#/components/schemas/GameStatus' },
          homeTeam: { $ref: '#/components/schemas/GameTeamSummary' },
          awayTeam: { $ref: '#/components/schemas/GameTeamSummary' },
          homeScore: { type: ['integer', 'null'], minimum: 0 },
          awayScore: { type: ['integer', 'null'], minimum: 0 },
          quarter: { type: ['integer', 'null'] },
          clock: { type: ['string', 'null'] },
          venue: {
            type: 'object',
            required: ['name', 'city'],
            properties: { name: { type: ['string', 'null'] }, city: { type: ['string', 'null'] } },
          },
          broadcastNetwork: { type: ['string', 'null'] },
          isNeutralSite: { type: 'boolean' },
        },
      },
      GameResponse: {
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: '#/components/schemas/Game' } },
      },
      GamePlayPosition: {
        type: 'object',
        required: ['down', 'distance', 'yardLine'],
        properties: {
          down: { type: ['integer', 'null'], minimum: 1, maximum: 4 },
          distance: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
          yardLine: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 100,
            description: 'Offense progress: own goal line 0, midfield 50, opponent goal line 100.',
          },
        },
      },
      GamePlay: {
        type: 'object',
        required: [
          'id',
          'sequence',
          'period',
          'clock',
          'possessionTeam',
          'type',
          'description',
          'start',
          'end',
          'flags',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sequence: { type: 'integer', minimum: 1 },
          period: { type: 'integer', minimum: 1, maximum: 10 },
          clock: { type: 'string' },
          possessionTeam: {
            oneOf: [{ $ref: '#/components/schemas/GameTeamSummary' }, { type: 'null' }],
          },
          type: {
            type: 'string',
            enum: [
              'PASS',
              'RUSH',
              'PUNT',
              'KICKOFF',
              'FIELD_GOAL',
              'SACK',
              'PENALTY',
              'TIMEOUT',
              'INTERCEPTION',
              'FUMBLE',
              'END_PERIOD',
              'OTHER',
            ],
          },
          description: { type: 'string' },
          start: { $ref: '#/components/schemas/GamePlayPosition' },
          end: { $ref: '#/components/schemas/GamePlayPosition' },
          flags: {
            type: 'object',
            required: ['scoring', 'penalty', 'turnover'],
            properties: {
              scoring: { type: 'boolean' },
              penalty: { type: 'boolean' },
              turnover: { type: 'boolean' },
            },
          },
        },
      },
      GamePlaysResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['gameId', 'playCount', 'plays'],
            properties: {
              gameId: { type: 'string', format: 'uuid' },
              playCount: { type: 'integer', minimum: 0 },
              plays: { type: 'array', items: { $ref: '#/components/schemas/GamePlay' } },
            },
          },
          meta: {
            type: 'object',
            required: ['limitations'],
            properties: { limitations: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
      CurrentGameScoringByPeriod: {
        type: 'object',
        required: ['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2'],
        properties: {
          q1: { type: ['integer', 'null'], minimum: 0 },
          q2: { type: ['integer', 'null'], minimum: 0 },
          q3: { type: ['integer', 'null'], minimum: 0 },
          q4: { type: ['integer', 'null'], minimum: 0 },
          ot1: { type: ['integer', 'null'], minimum: 0 },
          ot2: { type: ['integer', 'null'], minimum: 0 },
        },
      },
      CurrentGameTeamStats: {
        type: 'object',
        required: [
          'teamId',
          'firstDowns',
          'firstDownsPassing',
          'firstDownsRushing',
          'firstDownsPenalty',
          'totalPlays',
          'totalYards',
          'passingCompletions',
          'passingAttempts',
          'passingYards',
          'passingInterceptions',
          'rushingAttempts',
          'rushingYards',
          'turnovers',
          'fumblesLost',
          'sacks',
          'sackYardsLost',
          'thirdDownConversions',
          'thirdDownAttempts',
          'fourthDownConversions',
          'fourthDownAttempts',
          'penalties',
          'penaltyYards',
          'possessionSeconds',
          'redZoneConversions',
          'redZoneAttempts',
          'totalDrives',
          'scoringByPeriod',
        ],
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          firstDowns: { type: ['integer', 'null'], minimum: 0 },
          firstDownsPassing: { type: ['integer', 'null'], minimum: 0 },
          firstDownsRushing: { type: ['integer', 'null'], minimum: 0 },
          firstDownsPenalty: { type: ['integer', 'null'], minimum: 0 },
          totalPlays: { type: ['integer', 'null'], minimum: 0 },
          totalYards: { type: ['integer', 'null'], minimum: 0 },
          passingCompletions: { type: ['integer', 'null'], minimum: 0 },
          passingAttempts: { type: ['integer', 'null'], minimum: 0 },
          passingYards: { type: ['integer', 'null'], minimum: 0 },
          passingInterceptions: { type: ['integer', 'null'], minimum: 0 },
          rushingAttempts: { type: ['integer', 'null'], minimum: 0 },
          rushingYards: { type: ['integer', 'null'], minimum: 0 },
          turnovers: { type: ['integer', 'null'], minimum: 0 },
          fumblesLost: { type: ['integer', 'null'], minimum: 0 },
          sacks: { type: ['integer', 'null'], minimum: 0 },
          sackYardsLost: { type: ['integer', 'null'], minimum: 0 },
          thirdDownConversions: { type: ['integer', 'null'], minimum: 0 },
          thirdDownAttempts: { type: ['integer', 'null'], minimum: 0 },
          fourthDownConversions: { type: ['integer', 'null'], minimum: 0 },
          fourthDownAttempts: { type: ['integer', 'null'], minimum: 0 },
          penalties: { type: ['integer', 'null'], minimum: 0 },
          penaltyYards: { type: ['integer', 'null'], minimum: 0 },
          possessionSeconds: { type: ['integer', 'null'], minimum: 0 },
          redZoneConversions: { type: ['integer', 'null'], minimum: 0 },
          redZoneAttempts: { type: ['integer', 'null'], minimum: 0 },
          totalDrives: { type: ['integer', 'null'], minimum: 0 },
          scoringByPeriod: { $ref: '#/components/schemas/CurrentGameScoringByPeriod' },
        },
      },
      CurrentGamePlayerIdentity: {
        type: 'object',
        required: ['id', 'displayName', 'position', 'positionGroup', 'headshotUrl'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          displayName: { type: 'string' },
          position: { type: ['string', 'null'] },
          positionGroup: { type: ['string', 'null'] },
          headshotUrl: { type: ['string', 'null'], format: 'uri' },
        },
      },
      CurrentGamePlayerStatsByCategory: {
        type: 'object',
        required: ['passing', 'rushing', 'receiving', 'defense', 'kicking', 'punting', 'returns'],
        properties: {
          passing: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'player',
                'completions',
                'attempts',
                'yards',
                'touchdowns',
                'interceptions',
                'sacksSuffered',
                'sackYardsLost',
              ],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                completions: { type: ['integer', 'null'] },
                attempts: { type: ['integer', 'null'] },
                yards: { type: ['integer', 'null'] },
                touchdowns: { type: ['integer', 'null'] },
                interceptions: { type: ['integer', 'null'] },
                sacksSuffered: { type: ['integer', 'null'] },
                sackYardsLost: { type: ['integer', 'null'] },
              },
            },
          },
          rushing: {
            type: 'array',
            items: {
              type: 'object',
              required: ['player', 'attempts', 'yards', 'touchdowns', 'longest'],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                attempts: { type: ['integer', 'null'] },
                yards: { type: ['integer', 'null'] },
                touchdowns: { type: ['integer', 'null'] },
                longest: { type: ['integer', 'null'] },
              },
            },
          },
          receiving: {
            type: 'array',
            items: {
              type: 'object',
              required: ['player', 'targets', 'receptions', 'yards', 'touchdowns', 'longest'],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                targets: { type: ['integer', 'null'] },
                receptions: { type: ['integer', 'null'] },
                yards: { type: ['integer', 'null'] },
                touchdowns: { type: ['integer', 'null'] },
                longest: { type: ['integer', 'null'] },
              },
            },
          },
          defense: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'player',
                'tacklesTotal',
                'tacklesSolo',
                'sacks',
                'tacklesForLoss',
                'passesDefended',
                'fumbles',
                'fumbleRecoveries',
                'touchdowns',
              ],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                tacklesTotal: { type: ['integer', 'null'] },
                tacklesSolo: { type: ['integer', 'null'] },
                sacks: { type: ['number', 'null'] },
                tacklesForLoss: { type: ['integer', 'null'] },
                passesDefended: { type: ['integer', 'null'] },
                fumbles: { type: ['integer', 'null'] },
                fumbleRecoveries: { type: ['integer', 'null'] },
                touchdowns: { type: ['integer', 'null'] },
              },
            },
          },
          kicking: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'player',
                'fieldGoalsMade',
                'fieldGoalsAttempted',
                'longestFieldGoal',
                'extraPointsMade',
                'extraPointsAttempted',
              ],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                fieldGoalsMade: { type: ['integer', 'null'] },
                fieldGoalsAttempted: { type: ['integer', 'null'] },
                longestFieldGoal: { type: ['integer', 'null'] },
                extraPointsMade: { type: ['integer', 'null'] },
                extraPointsAttempted: { type: ['integer', 'null'] },
              },
            },
          },
          punting: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'player',
                'punts',
                'yards',
                'average',
                'inside20',
                'touchbacks',
                'longest',
              ],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                punts: { type: ['integer', 'null'] },
                yards: { type: ['integer', 'null'] },
                average: { type: ['number', 'null'] },
                inside20: { type: ['integer', 'null'] },
                touchbacks: { type: ['integer', 'null'] },
                longest: { type: ['integer', 'null'] },
              },
            },
          },
          returns: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'player',
                'kickReturns',
                'kickReturnYards',
                'kickReturnTouchdowns',
                'longestKickReturn',
                'puntReturns',
                'puntReturnYards',
                'puntReturnTouchdowns',
                'longestPuntReturn',
              ],
              properties: {
                player: { $ref: '#/components/schemas/CurrentGamePlayerIdentity' },
                kickReturns: { type: ['integer', 'null'] },
                kickReturnYards: { type: ['integer', 'null'] },
                kickReturnTouchdowns: { type: ['integer', 'null'] },
                longestKickReturn: { type: ['integer', 'null'] },
                puntReturns: { type: ['integer', 'null'] },
                puntReturnYards: { type: ['integer', 'null'] },
                puntReturnTouchdowns: { type: ['integer', 'null'] },
                longestPuntReturn: { type: ['integer', 'null'] },
              },
            },
          },
        },
      },
      CurrentGameLeadersByTeam: {
        type: 'object',
        required: ['passer', 'rusher', 'receiver'],
        properties: {
          passer: { type: ['object', 'null'] },
          rusher: { type: ['object', 'null'] },
          receiver: { type: ['object', 'null'] },
        },
      },
      CurrentGameStatsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['gameId', 'teamStats', 'playerStats', 'gameLeaders'],
            properties: {
              gameId: { type: 'string', format: 'uuid' },
              teamStats: {
                type: 'object',
                required: ['home', 'away'],
                properties: {
                  home: { $ref: '#/components/schemas/CurrentGameTeamStats' },
                  away: { $ref: '#/components/schemas/CurrentGameTeamStats' },
                },
              },
              playerStats: {
                type: 'object',
                required: ['home', 'away'],
                properties: {
                  home: { $ref: '#/components/schemas/CurrentGamePlayerStatsByCategory' },
                  away: { $ref: '#/components/schemas/CurrentGamePlayerStatsByCategory' },
                },
              },
              gameLeaders: {
                type: 'object',
                required: ['home', 'away'],
                properties: {
                  home: { $ref: '#/components/schemas/CurrentGameLeadersByTeam' },
                  away: { $ref: '#/components/schemas/CurrentGameLeadersByTeam' },
                },
              },
            },
          },
          meta: {
            type: 'object',
            required: [
              'playerStatsAvailable',
              'playerStatsCoverageState',
              'playerStatsCoverage',
              'limitations',
            ],
            properties: {
              playerStatsAvailable: { type: 'boolean' },
              playerStatsCoverageState: {
                type: 'string',
                enum: ['COMPLETE', 'PARTIAL', 'PENDING', 'UNAVAILABLE'],
              },
              playerStatsCoverage: {
                type: ['object', 'null'],
                required: ['providerRows', 'resolvedRows', 'unresolvedRows'],
                properties: {
                  providerRows: { type: 'integer', minimum: 0 },
                  resolvedRows: { type: 'integer', minimum: 0 },
                  unresolvedRows: { type: 'integer', minimum: 0 },
                },
              },
              limitations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      CurrentGameStatsListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['season', 'seasonType', 'week', 'games'],
            properties: {
              season: { type: 'integer' },
              seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
              week: { oneOf: [{ type: 'integer' }, { type: 'string', enum: ['ALL'] }] },
              games: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['game', 'coverage', 'teamStats'],
                  properties: {
                    game: { $ref: '#/components/schemas/Game' },
                    coverage: {
                      type: 'string',
                      enum: ['PENDING', 'COMPLETE', 'PARTIAL', 'UNAVAILABLE'],
                    },
                    teamStats: {
                      type: 'object',
                      required: ['home', 'away'],
                      properties: {
                        home: {
                          oneOf: [
                            { $ref: '#/components/schemas/CurrentGameTeamStats' },
                            { type: 'null' },
                          ],
                        },
                        away: {
                          oneOf: [
                            { $ref: '#/components/schemas/CurrentGameTeamStats' },
                            { type: 'null' },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          meta: {
            type: 'object',
            required: [
              'availableSeasons',
              'availableSeasonTypes',
              'availableWeeks',
              'coverageNote',
            ],
            properties: {
              availableSeasons: { type: 'array', items: { type: 'integer' } },
              availableSeasonTypes: {
                type: 'array',
                items: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
              },
              availableWeeks: { type: 'array', items: { type: 'integer' } },
              coverageNote: { type: 'string' },
            },
          },
        },
      },
      GameListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Game' } },
          meta: {
            type: 'object',
            required: ['nextCursor'],
            properties: { nextCursor: { type: ['string', 'null'], format: 'uuid' } },
          },
        },
      },
      User: {
        type: 'object',
        required: [
          'id',
          'email',
          'displayName',
          'isActive',
          'favoriteTeam',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          displayName: { type: ['string', 'null'] },
          isActive: { type: 'boolean' },
          favoriteTeam: {
            oneOf: [{ $ref: '#/components/schemas/Team' }, { type: 'null' }],
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['user', 'accessToken', 'accessTokenExpiresIn'],
            properties: {
              user: { $ref: '#/components/schemas/User' },
              accessToken: { type: 'string', description: 'Short-lived JWT access token.' },
              accessTokenExpiresIn: {
                type: 'integer',
                minimum: 1,
                description: 'Lifetime in seconds.',
              },
            },
          },
        },
      },
      CurrentUserResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['user'],
            properties: { user: { $ref: '#/components/schemas/User' } },
          },
        },
      },
      UpdateFavoriteTeamRequest: {
        type: 'object',
        required: ['favoriteTeamId'],
        additionalProperties: false,
        properties: {
          favoriteTeamId: {
            type: ['string', 'null'],
            format: 'uuid',
            description: 'An internal Team.id, or null to clear the favorite team.',
          },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true },
          displayName: { type: ['string', 'null'], minLength: 1, maxLength: 80 },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true },
        },
      },
      ForgotPasswordRequest: {
        type: 'object',
        required: ['email'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
        },
      },
      ResetPasswordRequest: {
        type: 'object',
        required: ['token', 'password'],
        additionalProperties: false,
        properties: {
          token: { type: 'string', minLength: 32, maxLength: 512, writeOnly: true },
          password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true },
        },
      },
      AdminGame: {
        type: 'object',
        required: ['id', 'resolved', 'base', 'providerManaged', 'provenance', 'override'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          resolved: { $ref: '#/components/schemas/Game' },
          base: { $ref: '#/components/schemas/Game' },
          providerManaged: { type: 'boolean' },
          provenance: {
            type: ['object', 'null'],
            properties: {
              sourceType: {
                type: 'string',
                enum: [
                  'MANUAL_IMPORT',
                  'MANUAL_ENTRY',
                  'OFFICIAL_WEB',
                  'PROVIDER',
                  'EDITORIAL_OVERRIDE',
                  'DEVELOPMENT_FIXTURE',
                ],
              },
              sourceName: { type: 'string' },
              sourceUrl: { type: ['string', 'null'], format: 'uri' },
              externalReference: { type: ['string', 'null'] },
              notes: { type: ['string', 'null'] },
              importedAt: { type: 'string', format: 'date-time' },
              verifiedAt: { type: ['string', 'null'], format: 'date-time' },
              verifiedById: { type: ['string', 'null'], format: 'uuid' },
            },
          },
          override: {
            type: ['object', 'null'],
            description:
              'Internal editorial values and notes. Never included in public game responses.',
          },
        },
      },
      AdminGameResponse: {
        type: 'object',
        required: ['data'],
        properties: { data: { $ref: '#/components/schemas/AdminGame' } },
      },
      AdminGameListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/AdminGame' } },
          meta: {
            type: 'object',
            required: ['nextCursor'],
            properties: { nextCursor: { type: ['string', 'null'], format: 'uuid' } },
          },
        },
      },
      ManualGameCreateRequest: {
        type: 'object',
        additionalProperties: false,
        required: [
          'season',
          'seasonType',
          'week',
          'startTime',
          'status',
          'homeTeamId',
          'awayTeamId',
          'venueName',
          'venueCity',
          'broadcastNetwork',
          'isNeutralSite',
          'provenance',
        ],
        properties: {
          season: { type: 'integer', minimum: 1920, maximum: 2100 },
          seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          week: { type: ['integer', 'null'], minimum: 1, maximum: 22 },
          startTime: {
            type: 'string',
            format: 'date-time',
            description: 'Offset or UTC timestamp required.',
          },
          status: { $ref: '#/components/schemas/GameStatus' },
          homeTeamId: { type: 'string', format: 'uuid' },
          awayTeamId: { type: 'string', format: 'uuid' },
          venueName: { type: ['string', 'null'], maxLength: 160 },
          venueCity: { type: ['string', 'null'], maxLength: 128 },
          broadcastNetwork: { type: ['string', 'null'], maxLength: 64 },
          isNeutralSite: { type: 'boolean' },
          provenance: {
            type: 'object',
            additionalProperties: false,
            required: ['sourceName'],
            properties: {
              sourceName: { type: 'string', maxLength: 160 },
              sourceUrl: { type: ['string', 'null'], format: 'uri' },
              externalReference: { type: ['string', 'null'], maxLength: 256 },
              notes: { type: ['string', 'null'], maxLength: 1000 },
            },
          },
        },
      },
      ManualGameUpdateRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        description:
          'A partial subset of manual game fields from ManualGameCreateRequest, excluding provenance.',
      },
      GameOverrideRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          startTime: { type: ['string', 'null'], format: 'date-time' },
          status: {
            type: ['string', 'null'],
            enum: [
              'SCHEDULED',
              'PREGAME',
              'IN_PROGRESS',
              'HALFTIME',
              'POSTPONED',
              'CANCELED',
              'SUSPENDED',
              null,
            ],
            description: 'FINAL must use the sourced result-fallback operation.',
          },
          week: { type: ['integer', 'null'], minimum: 1, maximum: 22 },
          venueName: { type: ['string', 'null'], maxLength: 160 },
          venueCity: { type: ['string', 'null'], maxLength: 128 },
          broadcastNetwork: { type: ['string', 'null'], maxLength: 64 },
          isNeutralSite: { type: ['boolean', 'null'] },
          publicCorrectionNote: { type: ['string', 'null'], maxLength: 500 },
          internalNote: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      GameResultFallbackRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'homeScore', 'awayScore', 'sourceName', 'reason'],
        properties: {
          status: { type: 'string', enum: ['FINAL'] },
          homeScore: { type: 'integer', minimum: 0 },
          awayScore: { type: 'integer', minimum: 0 },
          sourceName: { type: 'string', minLength: 1, maxLength: 160 },
          sourceUrl: { type: ['string', 'null'], format: 'uri', maxLength: 2048 },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
          internalNote: { type: ['string', 'null'], maxLength: 1000 },
          publicCorrectionNote: { type: ['string', 'null'], maxLength: 500 },
          dryRun: { type: 'boolean', default: true },
        },
      },
      GameResultFallbackResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['dryRun', 'outcome', 'game', 'resultCoverage', 'teamStatCoverage'],
            properties: {
              dryRun: { type: 'boolean' },
              outcome: {
                type: 'string',
                enum: ['WOULD_CREATE', 'WOULD_UPDATE', 'CREATED', 'UPDATED', 'UNCHANGED'],
              },
              game: { $ref: '#/components/schemas/AdminGame' },
              resultCoverage: { type: 'string', enum: ['EDITORIAL_RESULT_FALLBACK'] },
              teamStatCoverage: {
                type: 'string',
                enum: ['TEAM_STATS_COMPLETE', 'TEAM_STATS_PARTIAL', 'TEAM_STATS_UNAVAILABLE'],
              },
            },
          },
        },
      },
      GameVerificationRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceName'],
        properties: {
          sourceName: { type: 'string', maxLength: 160 },
          sourceUrl: { type: ['string', 'null'], format: 'uri' },
          note: { type: ['string', 'null'], maxLength: 1000 },
        },
      },
      ScheduleImportRow: {
        type: 'object',
        additionalProperties: false,
        required: [
          'season',
          'seasonType',
          'week',
          'startTime',
          'awayTeam',
          'homeTeam',
          'status',
          'venueName',
          'venueCity',
          'broadcastNetwork',
          'isNeutralSite',
          'sourceName',
          'sourceType',
          'sourceUrl',
          'externalReference',
          'notes',
        ],
        properties: {
          season: { type: 'integer', minimum: 1920, maximum: 2100 },
          seasonType: { type: 'string', enum: ['PRE', 'REG', 'POST'] },
          week: { type: ['integer', 'null'], minimum: 1, maximum: 22 },
          startTime: {
            oneOf: [
              { type: 'string', format: 'date-time' },
              { type: 'string', enum: ['TBD'] },
            ],
            description: 'Offset/UTC timestamp, or TBD when no official kickoff is assigned.',
          },
          awayTeam: { type: 'string', description: 'Canonical abbreviation or documented alias.' },
          homeTeam: { type: 'string', description: 'Canonical abbreviation or documented alias.' },
          status: { $ref: '#/components/schemas/GameStatus' },
          venueName: { type: ['string', 'null'] },
          venueCity: { type: ['string', 'null'] },
          broadcastNetwork: { type: ['string', 'null'] },
          isNeutralSite: { type: 'boolean' },
          sourceName: { type: 'string' },
          sourceType: {
            type: 'string',
            enum: ['MANUAL_IMPORT', 'OFFICIAL_WEB', 'DEVELOPMENT_FIXTURE'],
          },
          sourceUrl: { type: ['string', 'null'], format: 'uri' },
          externalReference: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
      },
      ScheduleImportRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['rows'],
        properties: {
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: { $ref: '#/components/schemas/ScheduleImportRow' },
          },
          dryRun: { type: 'boolean', default: true },
        },
      },
      ScheduleImportResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: [
              'dryRun',
              'received',
              'created',
              'updated',
              'skipped',
              'warnings',
              'failed',
              'failures',
            ],
            properties: {
              dryRun: { type: 'boolean' },
              received: { type: 'integer', minimum: 0 },
              created: { type: 'integer', minimum: 0 },
              updated: { type: 'integer', minimum: 0 },
              skipped: { type: 'integer', minimum: 0 },
              warnings: { type: 'integer', minimum: 0 },
              failed: { type: 'integer', minimum: 0 },
              failures: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['row', 'code', 'message'],
                  properties: {
                    row: { type: 'integer' },
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      ArticleType: {
        type: 'string',
        enum: ['ORIGINAL', 'CURATED', 'ANNOUNCEMENT'],
      },
      ArticleStatus: {
        type: 'string',
        enum: ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'],
      },
      ArticleTeamSummary: {
        type: 'object',
        required: ['id', 'abbreviation', 'fullName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          abbreviation: { type: 'string' },
          fullName: { type: 'string' },
        },
      },
      PublicArticleListItem: {
        type: 'object',
        required: [
          'id',
          'slug',
          'type',
          'title',
          'summary',
          'contentType',
          'mediaThumbnailUrl',
          'sourceName',
          'sourceUrl',
          'sourcePublishedAt',
          'sourceIsOfficialTeam',
          'heroImageUrl',
          'heroImageAlt',
          'isFeatured',
          'publishedAt',
          'teams',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          type: { $ref: '#/components/schemas/ArticleType' },
          title: { type: 'string' },
          summary: { type: ['string', 'null'] },
          contentType: { $ref: '#/components/schemas/NewsContentType' },
          mediaThumbnailUrl: {
            type: ['string', 'null'],
            format: 'uri',
            description:
              'Feed-provided thumbnail for VIDEO/HIGHLIGHT content; never a direct video file.',
          },
          sourceName: { type: ['string', 'null'] },
          sourceUrl: { type: ['string', 'null'], format: 'uri' },
          sourcePublishedAt: { type: ['string', 'null'], format: 'date-time' },
          sourceIsOfficialTeam: {
            type: 'boolean',
            description:
              'Provenance only, snapshotted from the originating NewsSource at conversion time -- not an editorial quality signal.',
          },
          heroImageUrl: { type: ['string', 'null'], format: 'uri' },
          heroImageAlt: { type: ['string', 'null'] },
          isFeatured: { type: 'boolean' },
          publishedAt: { type: 'string', format: 'date-time' },
          teams: { type: 'array', items: { $ref: '#/components/schemas/ArticleTeamSummary' } },
        },
      },
      PublicArticleDetail: {
        allOf: [
          { $ref: '#/components/schemas/PublicArticleListItem' },
          {
            type: 'object',
            required: [
              'body',
              'seoTitle',
              'seoDescription',
              'heroImageAttribution',
              'heroImageAttributionUrl',
            ],
            properties: {
              body: {
                type: ['string', 'null'],
                description: 'Sanitized Markdown source; render with a safe Markdown renderer.',
              },
              seoTitle: { type: ['string', 'null'] },
              seoDescription: { type: ['string', 'null'] },
              heroImageAttribution: { type: ['string', 'null'] },
              heroImageAttributionUrl: { type: ['string', 'null'], format: 'uri' },
            },
          },
        ],
      },
      PublicArticleListResponse: articleListResponse('#/components/schemas/PublicArticleListItem'),
      PublicArticleDetailResponse: dataResponse('#/components/schemas/PublicArticleDetail'),
      AdminArticleListItem: {
        type: 'object',
        required: [
          'id',
          'slug',
          'type',
          'status',
          'version',
          'title',
          'summary',
          'contentType',
          'mediaThumbnailUrl',
          'isFeatured',
          'featuredPriority',
          'publishedAt',
          'scheduledFor',
          'teams',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string' },
          type: { $ref: '#/components/schemas/ArticleType' },
          status: { $ref: '#/components/schemas/ArticleStatus' },
          version: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          summary: { type: ['string', 'null'] },
          contentType: { $ref: '#/components/schemas/NewsContentType' },
          mediaThumbnailUrl: { type: ['string', 'null'], format: 'uri' },
          isFeatured: { type: 'boolean' },
          featuredPriority: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
          scheduledFor: { type: ['string', 'null'], format: 'date-time' },
          teams: { type: 'array', items: { $ref: '#/components/schemas/ArticleTeamSummary' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AdminArticleDetail: {
        allOf: [
          { $ref: '#/components/schemas/AdminArticleListItem' },
          {
            type: 'object',
            required: [
              'body',
              'sourceName',
              'sourceUrl',
              'sourcePublishedAt',
              'sourceIsOfficialTeam',
              'heroImageUrl',
              'heroImageAlt',
              'heroImageAttribution',
              'heroImageAttributionUrl',
              'seoTitle',
              'seoDescription',
              'featuredStartsAt',
              'featuredEndsAt',
            ],
            properties: {
              body: { type: ['string', 'null'] },
              sourceName: { type: ['string', 'null'] },
              sourceUrl: { type: ['string', 'null'], format: 'uri' },
              sourcePublishedAt: { type: ['string', 'null'], format: 'date-time' },
              sourceIsOfficialTeam: { type: 'boolean' },
              heroImageUrl: { type: ['string', 'null'], format: 'uri' },
              heroImageAlt: { type: ['string', 'null'] },
              heroImageAttribution: { type: ['string', 'null'] },
              heroImageAttributionUrl: { type: ['string', 'null'], format: 'uri' },
              seoTitle: { type: ['string', 'null'] },
              seoDescription: { type: ['string', 'null'] },
              featuredStartsAt: { type: ['string', 'null'], format: 'date-time' },
              featuredEndsAt: { type: ['string', 'null'], format: 'date-time' },
            },
          },
        ],
      },
      AdminArticleListResponse: articleListResponse('#/components/schemas/AdminArticleListItem'),
      AdminArticleDetailResponse: dataResponse('#/components/schemas/AdminArticleDetail'),
      ArticleCreateRequest: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'title',
          'summary',
          'body',
          'sourceName',
          'sourceUrl',
          'sourcePublishedAt',
          'heroImageUrl',
          'heroImageAlt',
          'heroImageAttribution',
          'heroImageAttributionUrl',
          'seoTitle',
          'seoDescription',
          'isFeatured',
          'featuredPriority',
          'featuredStartsAt',
          'featuredEndsAt',
        ],
        properties: articleEditorialProperties,
      },
      ArticleUpdateRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion'],
        properties: {
          ...articleEditorialProperties,
          expectedVersion: { type: 'integer', minimum: 1 },
          changeSummary: { type: ['string', 'null'], maxLength: 500 },
        },
      },
      ArticleTeamsRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'teamIds'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          teamIds: {
            type: 'array',
            maxItems: 32,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
          changeSummary: { type: ['string', 'null'], maxLength: 500 },
        },
      },
      ArticleVersionActionRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          changeSummary: { type: ['string', 'null'], maxLength: 500 },
        },
      },
      ArticleScheduleRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'scheduledFor'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          scheduledFor: { type: 'string', format: 'date-time' },
          changeSummary: { type: ['string', 'null'], maxLength: 500 },
        },
      },
      ArticleRevision: {
        type: 'object',
        required: [
          'id',
          'articleId',
          'revisionNumber',
          'editorSnapshot',
          'snapshot',
          'changeSummary',
          'createdAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          articleId: { type: 'string', format: 'uuid' },
          revisionNumber: { type: 'integer', minimum: 1 },
          editorSnapshot: { type: 'string' },
          snapshot: { type: 'object', additionalProperties: true },
          changeSummary: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ArticleRevisionListResponse: articleListResponse('#/components/schemas/ArticleRevision'),
      ArticleRevisionResponse: dataResponse('#/components/schemas/ArticleRevision'),
      AuditEventListResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'array',
            items: { type: 'object', description: 'Sanitized immutable-style audit event.' },
          },
          meta: {
            type: 'object',
            required: ['nextCursor'],
            properties: { nextCursor: { type: ['string', 'null'], format: 'uuid' } },
          },
        },
      },
      MessageResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
