# 2nd and 15 Backend

Backend REST API for the 2nd and 15 consumer NFL platform.

The implemented backend includes the TypeScript/Express foundation, a normalized mock-backed catalog of all 32 active NFL teams, email/password authentication, rotating database-backed refresh sessions, password reset, and one favorite NFL team per user.

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

4. Apply committed migrations and seed the NFL teams. Both commands use `DATABASE_URL`:

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
- `POST /api/v1/auth/register` — register and immediately create a session
- `POST /api/v1/auth/login` — authenticate with email and password
- `POST /api/v1/auth/refresh` — rotate the cookie-backed refresh session
- `POST /api/v1/auth/logout` — revoke the current session and clear its cookie
- `POST /api/v1/auth/forgot-password` — request generic reset instructions
- `POST /api/v1/auth/reset-password` — consume a single-use reset token
- `GET /api/v1/users/me` — return the authenticated active user and favorite team
- `PATCH /api/v1/users/me/favorite-team` — set, replace, or clear the authenticated user's favorite team
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
- Never commit `.env`; only placeholder examples belong in `.env.example`.

## Team data

`npm run prisma:seed` reads the validated local fixture through the `mock` sports provider and upserts teams by the application catalog key. Provider IDs are stored only in `TeamProviderMapping`; API responses use internal team UUIDs and never expose mappings. Fixture logos and logo sources are currently `null`, allowing clients to fall back to abbreviation badges without assuming asset rights.

## Frontend authentication contract

- Registration and login return a short-lived access JWT in JSON and set the opaque refresh token only as an `HttpOnly` cookie.
- Keep the access token in application memory and send it as `Authorization: Bearer <token>`. Do not store the refresh token or attempt to read its cookie from JavaScript.
- Browser calls to register, login, refresh, logout, and reset-password should use `credentials: 'include'` so cookies can be accepted, rotated, or cleared.
- The refresh cookie is restricted to `/api/v1/auth`, lasts 30 days by default, and is replaced on every refresh.
- A password reset does not authenticate the user. It revokes all refresh sessions, clears the current refresh cookie, and requires a new login.
- User objects returned by registration, login, refresh, and `/users/me` contain `favoriteTeam`. New users and users who have cleared the relationship receive `favoriteTeam: null`.
- Set or replace a favorite with `{ "favoriteTeamId": "<internal-team-uuid>" }`; clear it with `{ "favoriteTeamId": null }`. Provider IDs and provider mappings are never part of this contract.

## Architecture

Read [AGENTS.md](AGENTS.md), [the product brief](docs/product-brief.md), [the backend architecture](docs/architecture.md), and [the MVP roadmap](docs/mvp-roadmap.md) before implementing a milestone.
