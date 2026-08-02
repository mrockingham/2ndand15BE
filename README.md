# 2nd and 15 Backend

Backend REST API for the 2nd and 15 consumer NFL platform.

The implemented backend includes the TypeScript/Express foundation, normalized NFL team and game catalogs, a fixture-backed mock provider, an explicit API-Sports synchronization adapter, email/password authentication, rotating database-backed refresh sessions, password reset, favorite-team personalization, role-protected schedule administration, and an internal revisioned editorial CMS for original, curated, and announcement content.

## Requirements

- Node.js 24 LTS
- npm 11
- A PostgreSQL database reachable through `DATABASE_URL` (a hosted development database such as Neon is supported)

Docker is optional. The supplied Compose file remains available if a local PostgreSQL container is useful later.

## Local setup

1. Copy `.env.example` to `.env`, set `DATABASE_URL`, and replace `JWT_ACCESS_SECRET` with at least 32 cryptographically random characters.

   Git Bash, macOS, or Linux:

   ```sh
   cp .env.example .env
   ```

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Install dependencies:

   ```sh
   npm ci
   ```

3. Validate the Prisma schema and generate the client:

   ```sh
   npm run prisma:generate
   ```

4. Apply committed migrations and seed the NFL teams and development-only game fixture. Both commands use `DATABASE_URL`:

   ```sh
   npm run prisma:deploy
   npm run prisma:seed
   ```

   The seed is transactional and idempotent, so it is safe to run repeatedly.

5. Start the API in watch mode:

   ```sh
   npm run dev
   ```

The API defaults to `http://localhost:3000`. The PostgreSQL credentials in `.env.example` are local-development placeholders; replace them when using a hosted database.

## Available endpoints

- `GET /api/v1/health` — process liveness
- `GET /api/v1/teams` — all active NFL teams in stable catalog order
- `GET /api/v1/teams/:teamId` — one active NFL team by internal UUID
- `GET /api/v1/games` — bounded, filterable normalized NFL game catalog
- `GET /api/v1/games/:gameId` — one game by internal UUID
- `GET /api/v1/teams/:teamId/games` — games involving one active team
- `GET /api/v1/articles` — bounded public article summaries
- `GET /api/v1/articles/featured` — active featured placement in deterministic order
- `GET /api/v1/articles/:slug` — one publicly visible article with Markdown content
- `GET /api/v1/teams/:teamId/articles` — public articles tagged to one active team
- `POST /api/v1/auth/register` — register and immediately create a session
- `POST /api/v1/auth/login` — authenticate with email and password
- `POST /api/v1/auth/refresh` — rotate the cookie-backed refresh session
- `POST /api/v1/auth/logout` — revoke the current session and clear its cookie
- `POST /api/v1/auth/forgot-password` — request generic reset instructions
- `POST /api/v1/auth/reset-password` — consume a single-use reset token
- `GET /api/v1/users/me` — return the authenticated active user and favorite team
- `PATCH /api/v1/users/me/favorite-team` — set, replace, or clear the authenticated user's favorite team
- `/api/v1/admin/*` — role-protected schedule, override, verification, import, and audit operations
- `/api/v1/admin/articles/*` — role-protected drafts, publishing, scheduling, tagging, and revisions
- `GET /api/v1/docs` — interactive OpenAPI documentation
- `GET /api/v1/docs/openapi.json` — OpenAPI JSON document

The health endpoint deliberately reports process health only. A database problem will affect database-backed routes such as `/teams` without making process liveness fail.

## Quality commands

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

Database-backed integration tests are opt-in so ordinary unit and route tests never depend on a developer database. Authentication tests create uniquely named temporary users and delete only those exact users afterward. After applying migrations and the team seed, run all database checks with:

Git Bash, macOS, or Linux:

```sh
RUN_DATABASE_TESTS=true npm test -- tests/integration
```

PowerShell:

```powershell
$env:RUN_DATABASE_TESTS = 'true'
npm.cmd test -- tests/integration
Remove-Item Env:RUN_DATABASE_TESTS
```

## Database commands

```sh
npm run prisma:generate
npm run prisma:validate
npm run prisma:seed
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:studio
npm run sports:sync:teams
npm run sports:sync:games
npm run sports:sync
npm run sports:verify:live
npm run sports:evaluate:api-sports -- --seasons=2024,2025,2026
npm run admin:set-role -- --email=user@example.com --role=ADMIN
npm run schedule:import -- --file=./data/import-templates/nfl-schedule.csv --dry-run
```

Use `prisma:migrate` only when authoring a new migration in development. Use `prisma:deploy` to apply committed migrations, including against a hosted development database.

To use the optional local PostgreSQL container:

```sh
docker compose up -d postgres
```

## Configuration

Configuration is validated at startup. See `.env.example` for the complete set.

- `DATABASE_URL` must be a PostgreSQL URL.
- For hosted PostgreSQL, prefer an explicitly verified TLS mode such as `sslmode=verify-full` when supported by the provider's connection string guidance.
- `CORS_ORIGINS` is a comma-separated allowlist of complete origins. Wildcards are rejected because refresh-cookie requests use credentials.
- `JWT_ACCESS_SECRET` has no application default and must contain at least 32 characters.
- `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, and `PASSWORD_RESET_TOKEN_TTL` accept durations such as `15m`, `30d`, and `30m`.
- `REFRESH_COOKIE_SECURE=true` is mandatory in production. `SameSite=None` also requires a secure cookie.
- `AUTH_RATE_LIMIT_*` configures credential and refresh endpoints; `PASSWORD_RESET_RATE_LIMIT_MAX` applies a stricter reset limit.
- `PASSWORD_RESET_FRONTEND_URL` is the frontend route to which the opaque reset token is appended as a query parameter.
- `EMAIL_PROVIDER=development` captures messages in memory. `EMAIL_DEV_LOG_RESET_URL=true` explicitly prints development reset URLs and is rejected in production. A production email vendor is not implemented.
- `SPORTS_PROVIDER=mock` is the safe default. Set it to `api-sports` only for real synchronization and source-isolated game reads.
- `CURRENT_NFL_SEASON` is required. Any game list query without an explicit `season` is constrained to this value.
- `ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS=false` is the safe default and is mandatory in production. Historical data remains available through an explicit `?season=<year>` query.
- `FIXTURE_DATA_ENABLED=false` hides fictional game records. Set it to `true` explicitly for local demonstrations that need the development schedule.
- `SPORTS_API` supplies the API-Sports credential. The key is required only when API-Sports is selected and must never be committed or logged.
- `API_SPORTS_SYNC_SEASON` and `API_SPORTS_SYNC_SEASON_TYPE` select the synchronization scope. Provider plans may restrict season access.
- API-Sports timeouts, bounded retries, base URL, and optional external-logo metadata are configured by the remaining `API_SPORTS_*` variables in `.env.example`.
- `HIGHLIGHTLY_API_KEY` is private and required only by `sports:evaluate:highlightly`. The remaining `HIGHLIGHTLY_*` variables configure its HTTPS endpoint, timeout, bounded retries, and evaluation season without changing `SPORTS_PROVIDER`.
- Never commit `.env`; only placeholder examples belong in `.env.example`.

## Team and game data

`npm run prisma:seed` reads the validated local fixture through the `mock` sports provider and upserts teams by the application catalog key. Provider IDs are stored only in `TeamProviderMapping`; API responses use internal team UUIDs and never expose mappings. Fixture logos and logo sources are currently `null`, allowing clients to fall back to abbreviation badges without assuming asset rights.

The same seed then synchronizes a small, explicitly fictional development schedule. It covers preseason, regular season, postseason, scheduled, pregame, in-progress, final, postponed, and canceled behavior without claiming to be an official NFL schedule. Games use internal team UUID relationships; provider game identities remain only in `GameProviderMapping`. Repeated synchronization preserves internal IDs, updates mutable game state, reports missing team mappings, and never deletes a game merely because a provider response omits it.

Game timestamps are stored and returned as UTC ISO 8601 values. The backend does not infer a display timezone. `GET /games` defaults to `CURRENT_NFL_SEASON` and the next 14 days, so unavailable current-season data produces an empty normalized list rather than historical fallback. `?season=2024` remains an explicit historical query. Date filters must be supplied together and may span at most 31 days. Cursor pagination is ordered by start time and internal game ID.

Public game values resolve editorial overrides over normalized base values without changing the response shape. Manually maintained games remain visible alongside the configured real provider, while fictional fixture visibility remains separately controlled. See [schedule imports](docs/schedule-imports.md) and [administrative authorization](docs/administration.md).

The editorial CMS stores constrained Markdown and external image/source metadata without fetching it. Scheduled visibility is derived during public reads, every mutation uses optimistic concurrency and creates an immutable revision, and public list DTOs omit bodies and editorial metadata. See [the editorial CMS guide](docs/editorial-cms.md).

API-Sports is available only through explicit synchronization commands; public routes never call it. In API-Sports mode, real teams are matched to the existing 32-team catalog and game reads exclude fictional mock records through private provider mappings. One team sync uses one provider call, one game sync uses one, and a combined sync normally uses two before bounded retries. Commands support `-- --dry-run`. See [the API-Sports integration guide](docs/api-sports.md) for configuration, status mapping, rate-limit behavior, fixture separation, failure recovery, and safe live verification.

Provider evaluations are read-only and never access Prisma. `sports:evaluate:api-sports` evaluates selected seasons and writes a sanitized report to `docs/provider-evaluations/api-sports-latest.md`. The reusable evaluation contract distinguishes verified, unavailable, and untested capabilities and records pass, warning, and failure findings. The approved baseline report is [API-Sports evaluation — August 1, 2026](docs/provider-evaluations/api-sports-2026-08-01.md).

`npm run sports:evaluate:highlightly` performs a bounded, read-only Highlightly NFL evaluation. It stops after team and 2026 schedule discovery when current-season records are absent and otherwise uses no more than eight HTTP requests. It does not import Prisma, synchronize records, create mappings, or change the active provider. See [the Highlightly evaluation guide](docs/highlightly-evaluation.md).

## Frontend authentication contract

- Registration and login return a short-lived access JWT in JSON and set the opaque refresh token only as an `HttpOnly` cookie.
- Keep the access token in application memory and send it as `Authorization: Bearer <token>`. Do not store the refresh token or attempt to read its cookie from JavaScript.
- Browser calls to register, login, refresh, logout, and reset-password should use `credentials: 'include'` so cookies can be accepted, rotated, or cleared.
- The refresh cookie is restricted to `/api/v1/auth`, lasts 30 days by default, and is replaced on every refresh.
- A password reset does not authenticate the user. It revokes all refresh sessions, clears the current refresh cookie, and requires a new login.
- User objects returned by registration, login, refresh, and `/users/me` contain `favoriteTeam` and the constrained `role`. Registration always creates `USER`; no public request may assign or change a role.
- Set or replace a favorite with `{ "favoriteTeamId": "<internal-team-uuid>" }`; clear it with `{ "favoriteTeamId": null }`. Provider IDs and provider mappings are never part of this contract.

## Architecture

Read [AGENTS.md](AGENTS.md), [the product brief](docs/product-brief.md), [the backend architecture](docs/architecture.md), and [the MVP roadmap](docs/mvp-roadmap.md) before implementing a milestone.
