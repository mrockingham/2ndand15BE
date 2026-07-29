# Backend Architecture

## Status

This document defines the architecture for the first backend vertical slice. The service foundation, normalized mock-backed team catalog, authentication lifecycle, database-backed refresh sessions, password-reset flow, and favorite-team personalization are implemented.

## System context

The backend is a Node.js/TypeScript REST service. A separately deployed consumer frontend calls it over HTTPS. PostgreSQL is the system of record for users, refresh sessions, teams, and provider mappings. During the initial slice, local fixture data stands in for a commercial sports source.

```text
Frontend
   |
   | HTTPS /api/v1
   v
Express API
   |-- Auth / Users services ------> PostgreSQL via Prisma
   |-- Teams service --------------> PostgreSQL via Prisma
   `-- Sports provider interface --> Mock fixture adapter
                                      (commercial adapters later)
```

Raw provider records stop at the adapter boundary. The frontend sees only API DTOs derived from normalized domain data.

## Technology direction

- Node.js with TypeScript in strict mode
- Express
- PostgreSQL
- Prisma ORM and migrations
- Zod boundary and environment validation
- JWT access tokens plus persistent refresh sessions
- Argon2id for password hashing
- Vitest for unit, route, and opt-in database integration tests
- ESLint and Prettier
- OpenAPI documentation
- Optional Docker Compose for local PostgreSQL; any reachable PostgreSQL service may be supplied through `DATABASE_URL`

The approved foundation uses Node.js 24 LTS, npm, ESM TypeScript, and Vitest. Argon2id is approved for the future authentication milestone, with bcrypt permitted only if deployment compatibility requires it.

## Module and layer design

Suggested layout:

```text
src/
  app.ts                    # Build/configure Express; no network listen
  server.ts                 # Validate config and start/stop the server
  config/                   # Environment schema and runtime configuration
  common/
    errors/                 # Typed application errors
    middleware/             # Auth, validation, rate limiting, error handling
    types/
    utils/
  modules/
    auth/
      auth.routes.ts
      auth.controller.ts
      auth.service.ts
      auth.schemas.ts
      auth.repository.ts
    users/
    teams/
    sports/
      sports-data-provider.ts
      normalized-sports.types.ts
      providers/
        mock/
          mock-sports-data-provider.ts
          nfl-teams.fixture.ts
  routes/                   # API router composition
  docs/                     # OpenAPI assembly/schemas if kept in source
prisma/
  schema.prisma
  migrations/
  seed.ts
tests/                      # Cross-module/integration helpers as needed
```

Feature folders may be adjusted as the code reveals better boundaries, but the responsibilities must remain separated:

- **Routes/controllers:** HTTP concerns only.
- **Schemas:** Parse and validate untrusted inputs.
- **Services:** Application use cases and business rules.
- **Repositories:** Persistence behind intentional methods.
- **Provider adapters:** External transport and normalization.
- **Composition root:** Select concrete implementations and wire dependencies.

`app.ts` should export an Express application without binding a port so route tests can execute in-process. `server.ts` owns startup, shutdown, and signal handling.

## Sports data abstraction

The planned provider contract is:

```ts
interface SportsDataProvider {
  getTeams(): Promise<NormalizedTeam[]>;
  getGamesByDate(date: string): Promise<NormalizedGame[]>;
  getGameById(gameId: string): Promise<NormalizedGame | null>;
  getPlayByPlay(gameId: string): Promise<NormalizedPlay[]>;
}
```

Only `getTeams` is currently declared and implemented. Games and play-by-play methods will be added to the interface with their own approved milestones rather than receive speculative placeholders.

The mock adapter must:

1. Read version-controlled local NFL team fixture data.
2. Validate the fixture shape.
3. Normalize values into provider-independent types.
4. Expose provider identifiers explicitly for mapping, not as product IDs.
5. Avoid network access in tests and local seeding.

The team seed validates all 32 fixture records, then transactionally upserts internal `Team` rows by league/abbreviation and `TeamProviderMapping` rows by provider/provider-team ID. Repeated seeds update the same records rather than duplicate them. Public endpoints read persisted internal teams so provider IDs never become public application IDs.

## Initial data model

The following is a logical model; exact Prisma scalar types and index names belong in the schema/migration.

### User

- `id`: internal stable ID
- `email`: trimmed display email
- `normalizedEmail`: lowercase unique login key
- `passwordHash`: never selected into public DTOs
- `displayName`: nullable
- `isActive`
- `favoriteTeamId`: nullable foreign key to internal `Team.id`
- `createdAt`, `updatedAt`

Deleting a selected team sets `favoriteTeamId` to null. The relationship is indexed for future team-oriented personalization queries and never uses provider-owned identifiers.

### RefreshToken / Session

Use a session record representing one refresh-token lineage:

- `id`: internal session/token identifier
- `userId`: foreign key
- `refreshTokenHash`: unique SHA-256 hash of the current opaque refresh token
- `expiresAt`
- `revokedAt`: nullable
- `lastUsedAt`: nullable rotation timestamp
- `createdAt`, `updatedAt`
- Optional bounded user-agent and IP metadata for session investigation

Deleting a user cascades to sessions. Rotation atomically replaces the stored hash; logout marks the current session revoked. The user-indexed session shape supports a future logout-all-devices operation.

### PasswordResetToken

- `id`, `userId`
- Unique SHA-256 `tokenHash`
- `expiresAt`, nullable `usedAt`, and `createdAt`
- Optional bounded request user-agent and IP metadata

Creating a reset invalidates earlier unused tokens. Consuming one atomically changes the password, marks/invalidate reset tokens, and revokes every refresh session. User deletion cascades to reset tokens.

### Team

- `id`: internal stable ID
- `league`
- `city`
- `name`
- `fullName`
- `abbreviation`
- `conference`
- `division`
- `primaryColor`
- `secondaryColor`
- `logoUrl`: nullable external URL
- `logoSource`: nullable attribution/source metadata
- `isActive`
- `createdAt`, `updatedAt`

Expected constraints include a unique abbreviation within a league and consistent canonical formatting. Colors should use a documented representation such as six-digit hex strings with a leading `#`.

### TeamProviderMapping

- `id`: internal mapping ID
- `teamId`: foreign key to `Team.id`
- `provider`: stable provider key such as `mock`, `api-sports`, or a future adapter name
- `providerTeamId`: provider-owned identifier stored as a string
- `createdAt`, `updatedAt`

The pair `(provider, providerTeamId)` must be unique. A team should have at most one mapping per provider unless a future provider contract demonstrates a legitimate need otherwise.

## HTTP API

All initial routes are under `/api/v1`.

| Method | Path                      | Authentication        | Purpose                                                    |
| ------ | ------------------------- | --------------------- | ---------------------------------------------------------- |
| GET    | `/health`                 | None                  | Process health; dependency readiness can be separate later |
| POST   | `/auth/register`          | None                  | Create a user and return authentication result             |
| POST   | `/auth/login`             | None                  | Authenticate credentials and return authentication result  |
| POST   | `/auth/refresh`           | Refresh token         | Rotate a refresh token and issue a new access token        |
| POST   | `/auth/logout`            | Refresh token/session | Revoke the current refresh session                         |
| POST   | `/auth/forgot-password`   | None                  | Return a generic reset-request response                    |
| POST   | `/auth/reset-password`    | Reset token in body   | Replace the password and revoke all sessions               |
| GET    | `/users/me`               | Access token          | Return the authenticated active user                       |
| PATCH  | `/users/me/favorite-team` | Access token          | Set, replace, or optionally clear the favorite team        |
| GET    | `/teams`                  | None                  | Return active normalized teams                             |
| GET    | `/teams/:teamId`          | None                  | Return one normalized team                                 |

The favorite-team endpoint accepts `favoriteTeamId: null` to clear the favorite. Every non-null value must reference an existing, active internal team.

### Response envelope

Successful responses with content use:

```json
{
  "data": {},
  "meta": {}
}
```

`meta` is optional and should be omitted when empty. Collection metadata may later contain pagination or cache information. A `204 No Content` response has no envelope.

Errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [],
    "requestId": "request-correlation-id"
  }
}
```

`details` is optional and must contain only safe, actionable field information. `code` is a stable machine-readable identifier. Unexpected errors return a generic message while retaining diagnostic context only in redacted server logs.

### DTO boundaries

- User DTOs expose `id`, `email`, `displayName`, active status, normalized favorite-team data or null, and timestamps, never normalized email, password hashes, reset tokens, or session fields.
- Team DTOs use internal `id` and the normalized Team attributes. Provider mappings are not included in ordinary public responses.
- Authentication DTOs must make access-token expiry unambiguous.
- OpenAPI is the source of truth for exact request and response properties once endpoints are implemented.

## Authentication design

The approved design is:

1. Registration normalizes the email, hashes the password, creates the user and refresh session, sets the refresh-token cookie, and returns the access token in the response body.
2. Login returns the same public authentication shape without revealing whether an account exists through overly specific failures.
3. Access tokens are short-lived signed JWTs, approximately 15 minutes by default, containing a minimal subject/session identity and standard timestamps. Clients send them in the `Authorization` header.
4. Refresh tokens live approximately 30 days by default. They are high-entropy credentials associated with server-side database sessions and are rotated on every successful refresh.
5. Only a hash of the refresh token is persisted. The raw token is sent only through an `HttpOnly` cookie and must never be stored in browser local storage.
6. Logout revokes the current session. Individual session revocation is supported, and the model must allow logout-all-devices to be added without redesigning sessions.
7. Reuse of a rotated, revoked, or expired token must fail safely.

Password reset uses a separate 256-bit opaque token with a 30-minute default lifetime. Only its SHA-256 hash is stored. Forgot-password responses are identical for known and unknown emails; the development email service captures reset messages in memory, and raw URL logging requires an explicit non-production flag. Successful reset is single-use, revokes all refresh sessions, invalidates other reset tokens, clears the refresh cookie, and does not create a new session.

Refresh-cookie requests are credentialed. Allowed CORS origins come from validated environment configuration; wildcard origins are incompatible with credentialed requests. Production refresh cookies use `Secure`, `HttpOnly`, and an explicitly selected `SameSite`, path, and domain policy appropriate to the final frontend/backend origins. The exact origins and cross-site cookie posture must be supplied before authentication is deployed.

## Validation and configuration

Environment values are parsed once at startup through Zod into a typed configuration object. Expected categories include:

- Runtime environment and port
- PostgreSQL connection URL
- Access-token signing secret and TTL
- Refresh-token TTL and hashing/pepper configuration if used
- Password-reset TTL, frontend URL, development email provider, and explicit development URL-output flag
- CORS origin(s)
- Logging level
- Rate-limit settings or safe defaults

`.env.example` contains names and non-secret examples only. Production secrets must be supplied by the deployment environment.

Zod schemas validate every request boundary. Database errors and Zod issues are mapped into application errors rather than leaked directly.

## Error handling, logging, and limits

- Assign or accept a safe request ID at the request boundary and return it on errors.
- Emit structured request logs with method, route, status, duration, and request ID.
- Redact authorization, cookies, password fields, and token values.
- Use a centralized not-found handler and a final centralized error handler.
- Apply a general limiter if needed and tighter limits to register/login/refresh routes.
- If running multiple instances, move rate-limit state to shared infrastructure; in-memory limits are only a basic single-instance starting point.

## Testing strategy

- **Unit tests:** normalization, validation helpers, token/password utilities, and service business rules.
- **Service tests:** use injected repositories/providers to cover success and domain failures.
- **Route/integration tests:** execute the Express app in-process, assert status/envelopes/auth behavior, and use an isolated test database where persistence behavior matters.
- **Migration/seed verification:** apply migrations to an empty database and run the team seed twice to prove idempotency.
- **Contract tests:** validate representative API responses against OpenAPI schemas when practical.

Critical cases include duplicate registration, invalid credentials, expired/revoked/rotated refresh tokens, unauthorized profile access, malformed IDs, inactive or absent favorite teams, and accidental secret fields in responses.

## Local development and operations

The Node service runs on the host for a fast development loop and accepts any PostgreSQL connection supplied through `DATABASE_URL`, including a hosted service such as Neon. Docker Compose is an optional local PostgreSQL convenience, not a development prerequisite. Startup fails fast on invalid configuration and handles termination signals by stopping new traffic and closing database connections.

The first health endpoint should confirm that the Express process can respond. If orchestration later needs database-aware readiness, add a separate readiness route rather than making liveness dependent on a transient database outage.

## Approved scaffolding defaults

These choices are approved for the service foundation:

- Node.js 24 LTS, pinned in repository metadata
- npm
- ESM TypeScript with a Node-compatible module configuration
- Vitest
- Argon2id for the future authentication milestone; bcrypt only if the deployment environment cannot support Argon2id
- UUIDs generated by the application/database for internal IDs
- JSON structured logging
- Refresh tokens in `HttpOnly` cookies and access tokens in response bodies

Any changed default should be reflected here and in an architecture decision record if it has long-term consequences.

## Deferred architecture

The interface leaves room for games and play-by-play, but no databases, queues, caches, websocket transport, AI model integration, prediction storage, or fantasy-provider integration should be designed in detail during this slice. Those features need their own requirements around latency, licensing, provenance, corrections, cost, and historical auditability.
