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

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: '2nd and 15 API',
    version: '0.1.0',
    description: 'Versioned backend API for the 2nd and 15 NFL platform.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
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
            description: 'Editors must supply GAME; admins may omit this filter.',
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
          'role',
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
          role: { type: 'string', enum: ['USER', 'EDITOR', 'ADMIN'] },
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
            type: 'string',
            format: 'date-time',
            description: 'UTC ISO 8601 timestamp.',
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
          status: { oneOf: [{ $ref: '#/components/schemas/GameStatus' }, { type: 'null' }] },
          week: { type: ['integer', 'null'], minimum: 1, maximum: 22 },
          venueName: { type: ['string', 'null'], maxLength: 160 },
          venueCity: { type: ['string', 'null'], maxLength: 128 },
          broadcastNetwork: { type: ['string', 'null'], maxLength: 64 },
          isNeutralSite: { type: ['boolean', 'null'] },
          publicCorrectionNote: { type: ['string', 'null'], maxLength: 500 },
          internalNote: { type: ['string', 'null'], maxLength: 1000 },
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
          startTime: { type: 'string', format: 'date-time' },
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
