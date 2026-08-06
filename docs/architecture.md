# Backend Architecture

## Status

This document defines the backend architecture through the public Team Hub milestone. The service foundation, normalized mock/API-Sports-backed team and game catalogs, authentication lifecycle, favorite-team personalization, role-protected schedule maintenance, revisioned original/curated editorial content, manual RSS/Atom candidate workflow, local 2020-2025 nflverse player data, Stats Hub, and composed Team Hub reads are implemented.

## System context

The backend is a Node.js/TypeScript REST service. A separately deployed consumer frontend calls it over HTTPS. PostgreSQL is the system of record for users, refresh sessions, teams, games, provenance, editorial overrides, audit events, and provider mappings. Local fixture data remains the default; API-Sports can be selected for explicit synchronization commands.

```text
Frontend
   |
   | HTTPS /api/v1
   v
Express API
   |-- Auth / Users services ------> PostgreSQL via Prisma
   |-- Teams / Games services -----> PostgreSQL via Prisma
   |-- Players / Stats services ---> PostgreSQL via Prisma
   |                                  ^
   |                                  `-- reviewed nflverse import CLI
   |-- News inbox service ---------> approved RSS/Atom feeds (manual trigger only)
   `-- Sports provider interface -+-> Mock fixture adapter
                                  `-> API-Sports adapter (sync commands only)
```

Raw provider records stop at the adapter boundary. The frontend sees only API DTOs derived from normalized domain data.

News feeds use a separate metadata-only boundary and never become sports providers. The feed client validates public DNS destinations and redirects, the SAX parser normalizes bounded RSS/Atom fields, and the repository performs idempotent candidate writes. Public requests never trigger feed fetches.

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
    historical-stats/         # manifest, Parquet validation, normalization, import
    players/                  # public player/profile/stat reads
    stats-hub/                # metric registry, ranked reads, recent summaries
    team-hub/                 # team composition and historical roster reads
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
  getTeams(): Promise<readonly NormalizedTeam[]>;
  getGames(query: GameQuery): Promise<readonly NormalizedGame[]>;
  getGameByProviderId(providerGameId: string): Promise<NormalizedGame | null>;
}
```

Teams and games are declared and implemented by the mock adapter. Play-by-play remains deferred rather than receiving a speculative provider contract.

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

### Game and GameProviderMapping

`Game` stores league, season/type/week, UTC start time, normalized status, internal home/away team foreign keys, nullable scores/period/clock, venue and broadcast metadata, neutral-site state, and timestamps. Home and away teams must differ; scores are nonnegative and either both present or both null. Schedule, status, and both team directions are indexed.

`GameProviderMapping` owns provider game identity. `(provider, providerGameId)` and `(gameId, provider)` are unique. Synchronization resolves provider team identities through `TeamProviderMapping`, creates or updates the mapped internal game in a transaction, preserves its UUID, skips identical records, reports missing mappings, and never deletes records absent from a response.

Provider status adapters map into `SCHEDULED`, `PREGAME`, `IN_PROGRESS`, `HALFTIME`, `FINAL`, `POSTPONED`, `CANCELED`, or `SUSPENDED`. Unknown source statuses must be handled explicitly by the adapter and cannot leak into persistence or public DTOs.

### Historical players and statistics

`Player.id` is the stable public UUID. `PlayerExternalIdentifier` owns GSIS and other provider/site identifiers; names are never unique keys and the identifier map is private. `PlayerWeekRoster` preserves player/team membership by season, week, season type, and source team, including midseason team changes and deliberate nullable team membership for non-team codes.

`PlayerGameStat` is a controlled wide table keyed by internal player, internal game, and internal team. It stores selected passing, rushing, receiving, defense, kicking, return, and explicitly named nflverse fantasy fields. Nullable source values stay null. Row hashes allow corrected files to update changed rows while unchanged rows are skipped.

`PlayerSeasonStat` contains deterministic player-wide `REG`, `POST`, and `REG_POST` summaries derived from weekly rows. `teamCount` preserves traded-player context without double counting. The aggregation version is stored and unchanged summaries retain their IDs during rebuilds.

`HistoricalDataset`, `HistoricalImportRun`, and `HistoricalImportFile` record source/release/schema/mapping metadata, checksums, row outcomes, warnings/failures, duration boundaries, and database sizes. A database-enforced dataset/season lease prevents concurrent releases from importing into the same logical slice. Raw files are never stored in PostgreSQL. The import pipeline is:

```text
allowlisted nflverse file or approved local file
  -> checksum and schema-drift review
  -> Zod normalization and mapping reconciliation
  -> bounded transactional upsert
  -> deterministic season-summary rebuild
  -> compact import and storage report
```

Historical schedules create or reuse normalized `Game` records and store nflverse game identity in `GameProviderMapping`. They do not modify the manually reviewed 2026 schedule, attach to development fixtures, infer kickoff timestamps, or create placeholders. Public requests never download source data.

### Stats Hub

The Stats Hub reads normalized `PlayerSeasonStat` and `PlayerGameStat` rows through a versioned, code-owned metric allowlist. Client metric IDs never become SQL identifiers. Full season leaderboards use stored summaries; a `teamId` filter deliberately aggregates only game rows recorded for that team. Competition rank is calculated with PostgreSQL window functions before opaque cursor filtering, preserving global ranks and stable tie ordering across pages.

Weekly leaders retain distinct player/game/team performances. Recent performance is limited to one internal player UUID and at most 20 recorded appearances. Null values are never coerced to zero. All responses are public-cacheable historical data with dataset-level nflverse attribution and exclude provider IDs and import metadata.

### Team Hub

The Team Hub is a read-only composition module. Its overview calls the existing `TeamReader`, source-isolated `GameReader`, and derived-visible `PublicArticleReader`, then adds team-scoped historical coverage from PostgreSQL. It does not reproduce team, game, article, or Stats Hub business rules and makes no provider or feed request.

Historical roster pages group `PlayerWeekRoster` by internal player, team, and selected season. Membership means at least one stored weekly roster row, not full-season/final/current membership or stat participation. Historical team, historical position/jersey/status, and the separately labeled latest-known profile team remain distinct. The query groups to one player row, caps a team-season at 500 candidates, then applies deterministic position-group/position/name/UUID ordering and a context-bound opaque cursor.

The team stat-leader path injects its internal path `teamId` into the existing Stats Hub season-leader service. Metric allowlisting, team-only aggregation, competition ranks, null/zero semantics, tie ordering, errors, cursor behavior, DTO privacy, and nflverse attribution are therefore shared rather than reimplemented. See `docs/team-hub/` for the API contract, semantics, and query-plan review.

## HTTP API

All initial routes are under `/api/v1`.

| Method | Path                                   | Authentication        | Purpose                                                     |
| ------ | -------------------------------------- | --------------------- | ----------------------------------------------------------- |
| GET    | `/health`                              | None                  | Process health; dependency readiness can be separate later  |
| POST   | `/auth/register`                       | None                  | Create a user and return authentication result              |
| POST   | `/auth/login`                          | None                  | Authenticate credentials and return authentication result   |
| POST   | `/auth/refresh`                        | Refresh token         | Rotate a refresh token and issue a new access token         |
| POST   | `/auth/logout`                         | Refresh token/session | Revoke the current refresh session                          |
| POST   | `/auth/forgot-password`                | None                  | Return a generic reset-request response                     |
| POST   | `/auth/reset-password`                 | Reset token in body   | Replace the password and revoke all sessions                |
| GET    | `/users/me`                            | Access token          | Return the authenticated active user                        |
| PATCH  | `/users/me/favorite-team`              | Access token          | Set, replace, or optionally clear the favorite team         |
| GET    | `/teams`                               | None                  | Return active normalized teams                              |
| GET    | `/teams/:teamId`                       | None                  | Return one normalized team                                  |
| GET    | `/teams/:teamId/hub`                   | None                  | Return compact schedule/news/historical Team Hub data       |
| GET    | `/teams/:teamId/roster`                | None                  | Return a historical weekly-roster-derived player page       |
| GET    | `/teams/:teamId/stat-leaders`          | None                  | Return the exact Stats Hub team-split leaderboard           |
| GET    | `/games`                               | None                  | Return a bounded, filterable page of normalized games       |
| GET    | `/games/:gameId`                       | None                  | Return one normalized game                                  |
| GET    | `/teams/:teamId/games`                 | None                  | Return games involving one active team                      |
| GET    | `/players`                             | None                  | Return a bounded normalized player page                     |
| GET    | `/players/:playerId`                   | None                  | Return one player by internal UUID                          |
| GET    | `/players/:playerId/stats`             | None                  | Return bounded weekly performances                          |
| GET    | `/players/:playerId/seasons`           | None                  | Return bounded-by-domain derived season summaries           |
| GET    | `/stats/metadata`                      | None                  | Return Stats Hub capabilities and imported coverage         |
| GET    | `/stats/leaders`                       | None                  | Return a deterministic player-season leaderboard            |
| GET    | `/stats/weekly-leaders`                | None                  | Return a deterministic weekly performance leaderboard       |
| GET    | `/stats/recent`                        | None                  | Return one player’s bounded recent performances             |
| GET    | `/articles`                            | None                  | Return visible article summaries                            |
| GET    | `/articles/featured`                   | None                  | Return active featured articles                             |
| GET    | `/articles/:slug`                      | None                  | Return one visible article with Markdown                    |
| GET    | `/teams/:teamId/articles`              | None                  | Return visible articles tagged to a team                    |
| GET    | `/admin/articles`                      | Editor/Admin          | View drafts and editorial article summaries                 |
| POST   | `/admin/articles`                      | Editor/Admin          | Create a draft and initial revision                         |
| PATCH  | `/admin/articles/:articleId`           | Editor/Admin          | Versioned article edit                                      |
| PUT    | `/admin/articles/:articleId/teams`     | Editor/Admin          | Replace active internal-team tags                           |
| POST   | `/admin/articles/:articleId/*`         | Editor/Admin          | Publish, unpublish, or schedule content                     |
| POST   | `/admin/articles/:articleId/archive`   | Admin                 | Archive content                                             |
| POST   | `/admin/articles/:articleId/restore`   | Admin                 | Restore archived content as unpublished                     |
| GET    | `/admin/articles/:articleId/revisions` | Editor/Admin          | Read immutable article revisions                            |
| GET    | `/admin/games`                         | Editor/Admin          | View games with internal provenance and overrides           |
| POST   | `/admin/games`                         | Editor/Admin          | Create a manually owned game                                |
| PATCH  | `/admin/games/:gameId`                 | Editor/Admin          | Edit a manually owned base game                             |
| PUT    | `/admin/games/:gameId/override`        | Editor/Admin          | Create or partially update an editorial override            |
| DELETE | `/admin/games/:gameId/override`        | Admin                 | Remove an editorial override                                |
| PUT    | `/admin/games/:gameId/verification`    | Editor/Admin          | Record factual verification                                 |
| POST   | `/admin/schedule-imports`              | Editor/Admin          | Validate or import bounded schedule rows                    |
| GET    | `/admin/audit-events`                  | Editor/Admin          | Read game-scoped (editor) or complete (admin) audit history |

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
- Player DTOs use internal UUIDs and page-level nflverse attribution. External identifiers, raw rows, source paths, checksums, import actors, and conflict metadata are never public.
- Team Hub roster DTOs use one internal player per selected historical team-season, label `historicalTeam` and `latestKnownTeam` separately, and expose no current-roster inference or source identity.
- Game DTOs use internal IDs, embedded safe team summaries, UTC timestamps, and explicit nullable fields. Provider mappings and synchronization metadata are never public.
- Public article list DTOs omit bodies; detail DTOs may return constrained Markdown but never lifecycle internals, scheduling metadata, versions, revisions, actor identities, or audit events.
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

## Game query and time behavior

Game list reads are capped at 100 records and use a UUID cursor with stable start-time/ID ordering. A request without an explicit season is constrained to `CURRENT_NFL_SEASON`; an entirely unfiltered request also defaults to a 14-day upcoming UTC window. If that season has no games, the result is empty and never falls back to an older season. Explicit historical seasons remain supported. Explicit date ranges require both bounds and may not exceed 31 days. Date-only bounds are interpreted as UTC calendar-day boundaries; timestamps must include an offset. Display timezone conversion belongs to clients.

## Provider synchronization architecture

Provider selection occurs at one factory boundary. `mock` remains the default. The API-Sports adapter validates external envelopes and records, normalizes dates/status/scores, and uses a dedicated HTTP client with timeouts and bounded idempotent retries. Manual CLI synchronization is the only external-fetch trigger. Public routes always read PostgreSQL and select games through private provider mappings, preventing mock and API-Sports records from being silently mixed.

`FIXTURE_DATA_ENABLED` controls whether the public game repository may select `mock` mappings. When disabled, it uses an internal no-source filter; fixture rows remain stored but cannot appear in game endpoints. API-Sports records remain available through the `api-sports` source, subject to the current-season query policy. Source classifications and mappings stay private.

API-Sports teams are matched to stable internal teams by existing mapping, abbreviation, then normalized full name. Real-provider synchronization does not create teams or overwrite approved local display metadata. Game synchronization resolves both team mappings and preserves stable internal game IDs. See `docs/api-sports.md` for operational details and the documented status map.

Provider evaluation is a separate read-only boundary. Evaluators produce validated, sanitized reports with explicit verified, unavailable, and untested evidence states plus pass/warning/failure findings. Evaluation never mutates PostgreSQL or stores request credentials. Reports live under `docs/provider-evaluations/` so future providers can be assessed before adapter approval.

The Highlightly evaluator is intentionally not a `SportsDataProvider` adapter. Its evaluation-only client validates the limited external payloads it inspects, authenticates through a private header, counts requests, applies timeouts and bounded idempotent retries, and has no database dependency. Running it cannot change `SPORTS_PROVIDER`, public DTOs, routes, mappings, or persisted sports data.

## Administrative schedule architecture

`User.role` is constrained to `USER`, `EDITOR`, or `ADMIN` and defaults to `USER`. Registration writes `USER` explicitly. Access-token claims remain limited to user/session identity; administrative middleware reads the active user's current role from PostgreSQL and checks an explicit capability map, so demotions do not wait for token expiry. Role management remains a deliberately narrow audited CLI operation.

`GameProvenance` records source type/name, optional source URL and external reference, import time, notes, and factual verification. Existing mock games are classified as `DEVELOPMENT_FIXTURE`; API-Sports games are classified as `PROVIDER`. `GameEditorialOverride` is one-to-one with a game and stores only supported schedule corrections. Nullable override fields fall back to the normalized base record. `AdminAuditEvent` is append-only through application APIs and retains actor snapshots even if relational actor IDs are later set null.

Public game reads fetch overrides with teams in one bounded query. Effective date, week, and status filtering and kickoff ordering use override values before base values. Candidate resolution is capped at 1,000 records; an overbroad query fails explicitly. Public DTOs expose only the effective game and retain their existing schema.

CSV and JSON imports validate complete batches before writing. CLI imports default to dry-run and require `--write`. Matching uses source external reference and then schedule identity. Manually owned matches update the base record; provider-backed matches create or update an editorial override, leaving provider mappings and base synchronization intact. See `docs/schedule-imports.md` and `docs/administration.md`.

Version-controlled factual schedule baselines are provider-independent inputs to that same import boundary. `schedule:review` is a pure, read-only aggregate check: it reads and validates CSV, resolves the canonical 32-team catalog and documented aliases, and reports counts, byes, duplicates, offsets, neutral sites, missing optional fields, notes, and blockers without importing Prisma or connecting to PostgreSQL. A baseline is not eligible for dry-run/write approval until it has 272 regular-season games, 18 weeks, 17 games and one bye per team, no duplicate/team-week conflicts, and stable external references. A kickoff is either an explicit-offset ISO timestamp or the literal CSV value `TBD`; `TBD` persists as a nullable `Game.startTime` and is returned publicly as `startTime: null`. Neither an NFL/ESPN date-only placeholder nor a default local time is persisted as a kickoff. Null kickoffs sort after dated games and do not match date-range filters.

The 2026 baseline uses `OFFICIAL_WEB`, NFL.com week pages, canonical team abbreviations, and references shaped as `nfl-2026-{pre|reg}-wNN-away-home`. UTC values come from the official event timestamps; international venue/time samples receive explicit review. Providers do not create this baseline, source URLs are not fetched by review/import commands, and Highlightly remains evaluation-only.

## Editorial CMS architecture

`Article` stores constrained original, curated, or announcement Markdown plus source/image metadata, lifecycle state, featured placement, and an integer concurrency version. `ArticleTeam` joins only active internal NFL teams at write time. `ArticleRevision` captures every successful mutation transactionally with a unique article/revision number; actor relations are nullable while editor snapshots preserve historical meaning.

Drafts are created separately from publish operations. Public visibility is derived from either `PUBLISHED` with `publishedAt <= now` or `SCHEDULED` with `scheduledFor <= now`; reads never mutate state and no scheduler or worker exists. Public resolution is capped at 500 candidates, uses effective publication time for ordering/cursors, and emits list DTOs without bodies. Featured windows affect only featured queries.

Administrative article writes require current-role capabilities and an `expectedVersion`. The `(id, version)` constraint supports atomic stale-write rejection. Each mutation creates one revision and a compact `ARTICLE` audit event containing a body digest/length instead of duplicating content. Source and image URLs accept HTTP(S) only and are never fetched. See `docs/editorial-cms.md`.

## Deferred architecture

The game fixture is development-only and is not official current NFL information. A CMS frontend, automatic ingestion/summarization, media handling, live polling, WebSockets, play-by-play, drives, statistics, standings, injuries, odds, predictions, fantasy, notifications, distributed caches, and queues remain deferred. These features need their own requirements around latency, licensing, provenance, corrections, cost, and historical auditability.
