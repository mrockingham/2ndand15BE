# 2nd and 15 Backend

Backend REST API for the 2nd and 15 consumer NFL platform.

The implemented backend includes the TypeScript/Express foundation, normalized NFL team and game catalogs, a fixture-backed mock provider, an explicit API-Sports synchronization adapter, email/password authentication, rotating database-backed refresh sessions, password reset, favorite-team personalization, role-protected schedule administration, an internal revisioned editorial CMS, a controlled RSS/Atom/manual news-candidate inbox, a provider-neutral human-reviewed editorial AI draft pipeline, a local PostgreSQL-backed 2020-2025 nflverse player/statistics foundation, the public Stats Hub, and composed public Team Hub APIs.

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

- `GET /api/v1/teams/:teamId/hub` — compact team, 2026 schedule, news, and historical coverage overview
- `GET /api/v1/teams/:teamId/roster` — cursor-paginated historical weekly-roster membership
- `GET /api/v1/teams/:teamId/stat-leaders` — exact Stats Hub team-split leaderboards

- `GET /api/v1/health` — process liveness
- `GET /api/v1/teams` — all active NFL teams in stable catalog order
- `GET /api/v1/teams/:teamId` — one active NFL team by internal UUID
- `GET /api/v1/games` — bounded, filterable normalized NFL game catalog
- `GET /api/v1/games/:gameId` — one game by internal UUID
- `GET /api/v1/teams/:teamId/games` — games involving one active team
- `GET /api/v1/players` — bounded player search/filter page using internal UUIDs
- `GET /api/v1/players/:playerId` — one normalized player profile
- `GET /api/v1/players/:playerId/stats` — bounded weekly performance history
- `GET /api/v1/players/:playerId/seasons` — deterministic season summaries
- `GET /api/v1/stats/metadata` — imported seasons, supported filters, and the versioned metric registry
- `GET /api/v1/stats/leaders` — deterministic season leaderboards and exact team splits
- `GET /api/v1/stats/weekly-leaders` — recorded weekly game/team performances
- `GET /api/v1/stats/recent` — one player’s bounded recent-performance summary
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
- `/api/v1/admin/news-sources/*` — approved source definitions, health, tests, and manual ingestion
- `/api/v1/admin/news-candidates/*` — private candidate review, manual submission, dismissal, and draft conversion
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

After the checksummed historical manifest has been imported, its read-only hosted verification is separately opt-in:

```powershell
$env:RUN_HISTORICAL_DATABASE_TESTS = 'true'
npm.cmd test -- tests/integration/historical-player.database.test.ts
Remove-Item Env:RUN_HISTORICAL_DATABASE_TESTS
```

Stats Hub queries have their own read-only hosted verification:

```powershell
$env:RUN_STATS_HUB_DATABASE_TESTS = 'true'
npm.cmd test -- tests/integration/stats-hub.database.test.ts
Remove-Item Env:RUN_STATS_HUB_DATABASE_TESTS
```

Team Hub composition, roster, and team-leader reads have a separate read-only hosted verification:

```powershell
$env:RUN_TEAM_HUB_DATABASE_TESTS = 'true'
npm.cmd test -- tests/integration/team-hub.database.test.ts
Remove-Item Env:RUN_TEAM_HUB_DATABASE_TESTS
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
npm run schedule:review -- --file=./data/schedules/nfl-2026.csv
npm run schedule:import -- --file=./data/import-templates/nfl-schedule.csv --dry-run
npm run news:ingest -- --source=approved-source-slug --actor=editor@example.com
npm run historical:download -- --dataset=weekly-rosters --seasons=2020-2025
npm run historical:review -- --manifest=./data/nflverse/manifests/nflverse-2020-2025.json
npm run historical:import -- --manifest=./data/nflverse/manifests/nflverse-2020-2025.json --season=2020 --write
npm run historical:reconcile -- --seasons=2020-2025
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
- `EDITORIAL_AI_PROVIDER=none` keeps AI optional. To enable the isolated OpenAI adapter, set it to `openai` and provide private `OPENAI_API_KEY` plus an explicit `OPENAI_EDITORIAL_MODEL`; public requests never invoke AI.
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

The committed `data/schedules/nfl-2026.csv` is a reviewed, provider-independent baseline from official NFL schedule pages. It contains 48 preseason and all 272 regular-season games. Twenty-four regular-season kickoffs still officially listed as TBD are stored as `null`, never as fabricated midnight timestamps; the public API returns `startTime: null` for those games. The August 2, 2026 import created 320 official rows, and an identical second write skipped all 320. See [the 2026 review report](docs/schedule-reviews/nfl-2026-review.md).

The editorial CMS stores constrained Markdown and external image/source metadata without fetching it. Scheduled visibility is derived during public reads, every mutation uses optimistic concurrency and creates an immutable revision, and public list DTOs omit bodies and editorial metadata. See [the editorial CMS guide](docs/editorial-cms.md).

The editorial AI assistant turns bounded candidate metadata into original attributed `DRAFT` records in private `NEEDS_REVIEW` state. It never scrapes, downloads media, or publishes. See [the editorial AI guide](docs/editorial-ai/README.md).

The source inbox fetches only explicitly approved RSS/Atom URLs when an editor/admin triggers a test or ingestion. It stores bounded metadata, never fetches linked article pages or images, never auto-publishes, and requires editor-written original content for conversion into a `CURATED` draft. There is no cron, queue, worker, webhook, scraper, or AI authoring. See [the news-source ingestion guide](docs/news-source-ingestion.md).

Historical player data is downloaded to ignored local files, checksum/schema reviewed, and imported only through an explicit bounded CLI. Public player and Stats Hub routes read PostgreSQL and never call nflverse or GitHub. External player/game IDs stay private in mapping tables, missing values remain distinct from zero, and season totals are deterministically rebuilt from weekly rows. See [the historical import guide](docs/historical-data/import-guide.md), [the 2020-2025 review](docs/historical-data/nflverse-player-stats-2020-2025.md), and [the Stats Hub API guide](docs/stats-hub/api-guide.md).

The public Team Hub composes existing team, schedule, article, historical roster, and Stats Hub behavior without provider calls or fabricated 2026 player data. Historical/latest-known teams remain separately labeled and roster membership requires a stored weekly roster row. See [the Team Hub API guide](docs/team-hub/api-guide.md), [semantics](docs/team-hub/semantics.md), and [performance review](docs/team-hub/performance-review.md).

API-Sports is available only through explicit synchronization commands; public routes never call it. In API-Sports mode, real teams are matched to the existing 32-team catalog and game reads exclude fictional mock records through private provider mappings. One team sync uses one provider call, one game sync uses one, and a combined sync normally uses two before bounded retries. Commands support `-- --dry-run`. See [the API-Sports integration guide](docs/api-sports.md) for configuration, status mapping, rate-limit behavior, fixture separation, failure recovery, and safe live verification.

Provider evaluations are read-only and never access Prisma. `sports:evaluate:api-sports` evaluates selected seasons and writes a sanitized report to `docs/provider-evaluations/api-sports-latest.md`. The reusable evaluation contract distinguishes verified, unavailable, and untested capabilities and records pass, warning, and failure findings. The approved baseline report is [API-Sports evaluation — August 1, 2026](docs/provider-evaluations/api-sports-2026-08-01.md).

`npm run sports:evaluate:highlightly` performs a bounded, read-only Highlightly NFL evaluation. It stops after team and 2026 schedule discovery when current-season records are absent and otherwise uses no more than eight HTTP requests. It does not import Prisma, synchronize records, create mappings, or change the active provider. See [the Highlightly evaluation guide](docs/highlightly-evaluation.md).

Manual current-game updates use a separate update-only boundary and require an existing internal game UUID. `games:current:verify` and `games:current:sync -- --gameId=<uuid> --dry-run` do not write; `games:current:sync -- --gameId=<uuid> --apply` is permitted only by the explicit evaluation/publication configuration guards. See [the current-season game guide](docs/current-season-games/README.md).

Current-game team and safely reconciled player box scores use the same guarded manual workflow through `games:current:details:verify` and `games:current:details:sync`. Public clients read stored team totals, period scoring, player categories, and neutral identity coverage at `GET /api/v1/games/:gameId/stats`; unresolved provider players are never published. The initial player reconciliation remains blocked until the provider quota permits all 82 profiles to be evaluated. See [the game-stat sync guide](docs/current-season-games/game-stats-sync.md) and [player identity guide](docs/current-season-games/player-identity-reconciliation.md).

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
