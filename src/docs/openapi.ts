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
