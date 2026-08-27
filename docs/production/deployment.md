# Production deployment guide

This document covers what's needed to take the 2nd & 15 backend from a
validated build to a running production deployment: the environment variable
checklist, the reverse-proxy trust setting, deployment order, the
liveness/readiness distinction, and fixture-data safety. It links out to the
other `docs/production/*.md` guides for the areas that deserve their own
document (the live-game worker, email, contact form, rollback).

Configuration is validated at process startup by `src/config/env.ts` — an
invalid or missing required variable throws `EnvironmentValidationError` and
the process never starts serving traffic. Treat that validation as the
source of truth; this guide explains _why_ the values matter, not a
substitute for reading `.env.example`.

## Environment variable checklist

`.env.example` is the complete, grouped list of every variable the backend
reads. Copy it, then work through it group by group. Below, each group is
called out with what needs a real production value versus what is safe to
leave at its documented default.

### Core / server

- `NODE_ENV=production` — flips on every production-only validation rule in
  `src/config/env.ts` (see the `superRefine` block at the bottom of the
  schema): rejects `FIXTURE_DATA_ENABLED=true`,
  `ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS=true`, `REFRESH_COOKIE_SECURE=false`,
  a non-`https://` `PASSWORD_RESET_FRONTEND_URL`, `EMAIL_DEV_LOG_RESET_URL=true`,
  `EMAIL_PROVIDER=development`, and a missing `CONTACT_TO_EMAIL`.
- `HOST` / `PORT` — usually left at defaults (`0.0.0.0` / `3000`) and
  fronted by a load balancer or reverse proxy.
- `DATABASE_URL` — must point at the production Postgres database. **Which
  Neon project/branch is production has not been confirmed as of this
  writing** — see `docs/production/rollback.md` for the process to follow
  before the first production migration.
- `LOG_LEVEL` — `info` is a reasonable production default; avoid `debug`/`trace`
  in production (verbose, and more likely to log sensitive request detail).
- `TRUST_PROXY` — needs a real production value. See the dedicated section
  below.

### CORS / rate limiting

- `CORS_ORIGINS` — must be the real production frontend origin(s), exact
  scheme+host+port, comma-separated. Wildcards are rejected outright because
  refresh-cookie requests are credentialed.
- `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` — the general per-IP limiter
  applied to the entire `/api/v1` router (see the readiness/liveness section
  below for why this matters to load balancer health checks). Defaults
  (`60000` / `100`) are a reasonable starting point; tune based on expected
  traffic.

### Auth

- `JWT_ACCESS_SECRET` — **required, no default.** Generate at least 32
  cryptographically random characters and never reuse the development value.
- `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` — defaults (`15m`, `30d`) are
  reasonable; change only with a considered reason.
- `REFRESH_COOKIE_SECURE` — **must be `true` in production** (enforced by
  config validation). `REFRESH_COOKIE_SAME_SITE=none` additionally requires
  `REFRESH_COOKIE_SECURE=true`.
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` — safe at defaults
  unless login/refresh traffic patterns require tuning.

### Forgot / reset password

- `PASSWORD_RESET_FRONTEND_URL` — **must use `https://` in production**
  (enforced by config validation) and must be the real frontend reset-page
  URL, since the raw single-use token is appended to it as a query
  parameter and emailed to the user.
- `PASSWORD_RESET_TOKEN_TTL`, `PASSWORD_RESET_RATE_LIMIT_MAX` — safe at
  defaults. See `docs/production/email.md` for the full reset-email flow.

### Email delivery

- `EMAIL_PROVIDER=resend` — **required in production**; `development` is
  rejected by config validation.
- `RESEND_API_KEY` — required when `EMAIL_PROVIDER=resend`; a real secret.
- `EMAIL_FROM` — the production From header, e.g.
  `2nd & 15 <support@2ndand15.com>`.
- `EMAIL_DEV_LOG_RESET_URL` — **must be `false` in production** (enforced by
  config validation); it exists only to help local development.

See `docs/production/email.md` for the full picture, including the
`EmailService` abstraction and the reset-token-not-deleted-on-failure policy.

### Contact form

- `CONTACT_TO_EMAIL` — **required in production** (enforced by config
  validation); the operator inbox that receives contact-form notifications.
- `CONTACT_RATE_LIMIT_WINDOW_MS` / `CONTACT_RATE_LIMIT_MAX` — a separate,
  stricter limiter from the general API rate limit. Defaults (1 hour window,
  5 submissions) are a reasonable anti-abuse starting point.

See `docs/production/contact.md` for the full contact-form design.

### Editorial AI

- `EDITORIAL_AI_PROVIDER=none` is safe to leave as-is unless the editorial AI
  drafting assistant is being enabled; if so, `OPENAI_API_KEY` and
  `OPENAI_EDITORIAL_MODEL` become required. Unrelated to the public API
  surface — public requests never invoke AI.

### Sports data / season configuration

- `CURRENT_NFL_SEASON` — required; must reflect the actual current season.
- `ALLOW_HISTORICAL_DEFAULT_GAME_RESULTS` — **must be `false` in production**
  (enforced by config validation).
- `FIXTURE_DATA_ENABLED` — **must be `false` in production** (enforced by
  config validation). See the dedicated section below.
- `SPORTS_API` / `API_SPORTS_*` — real production credentials and sync
  settings if `SPORTS_PROVIDER=api-sports`; otherwise the `mock` default
  needs no credential.

### News ingestion policy

- `NEWS_INITIAL_INGEST_LOOKBACK_HOURS`, `NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE`,
  `NEWS_LATE_ITEM_TOLERANCE_HOURS` — policy knobs, safe at defaults unless a
  specific ingestion behavior change is intended.

### Game Center curated video embeds

- `GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST` — safe at the documented YouTube
  default unless a new embed host is explicitly approved.

### Highlightly current-game provider

- `HIGHLIGHTLY_API_KEY` — real production credential, required.
- `HIGHLIGHTLY_EVALUATION_MODE` / `HIGHLIGHTLY_PUBLICATION_APPROVED` —
  exactly one must be `true` (enforced by config validation). Evaluation mode
  is for pre-production review; flipping to publication-approved is the
  explicit production go-live decision for Highlightly-sourced content and
  should be made deliberately, separate from other deploy steps.
- `HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED` — keep `false` until real embed
  playback has been confirmed working for a meaningful sample of highlights
  (see the comment in `.env.example` / `src/config/env.ts`); this is
  independent from the poller/worker being enabled.

### Current-game live poller / worker

- `CURRENT_GAME_POLLER_ENABLED=true` — the master switch for broad polling
  and for the long-running worker. See `docs/production/live-game-worker.md`.
- `CURRENT_GAME_POLLER_HEARTBEAT_SECONDS`, `CURRENT_GAME_POLLER_BATCH_SIZE`,
  `CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS`, and the
  `CURRENT_GAME_*_POLL_SECONDS` / `CURRENT_GAME_FINAL_RECONCILE_*_MINUTES` /
  `CURRENT_GAME_RATE_LIMIT_DEGRADE_THRESHOLD` block — safe at the documented
  defaults for initial launch; tune only with a specific operational reason
  (all are validated with sane min/max bounds).

## `TRUST_PROXY`

Express's `trust proxy` setting controls how many hops of `X-Forwarded-For`
the app trusts to determine a client's real IP — which in turn feeds
rate limiting and request logging. `TRUST_PROXY` accepts either:

- a **numeric hop count** (e.g. `1` for a single load balancer/reverse proxy
  directly in front of the app), or
- a **comma-separated list of trusted proxy IPs/CIDRs**.

It deliberately **rejects `"true"` and `"*"`** (see `trustProxySchema` in
`src/config/env.ts`). Setting `trust proxy` to `true` tells Express to trust
_every_ hop in `X-Forwarded-For`, including one a client appends itself —
which lets a malicious client spoof its own IP and dodge the per-IP rate
limiters entirely. Set `TRUST_PROXY` to the actual number of trusted
infrastructure hops between the client and this process (commonly `1` behind
a single load balancer), or to an explicit allowlist of trusted proxy
addresses if the topology is more complex.

## Deployment order

Production processes are `npm ci && npm run build` once, then two separate
long-running processes started from the compiled output:

```sh
npm ci
npm run build              # prisma generate && tsc -p tsconfig.build.json
npm run prisma:deploy      # prisma migrate deploy -- NEVER prisma migrate dev in production
npm start                  # node dist/server.js -- the HTTP API
```

The current-game live worker is a **separate process**, not something
`npm start` launches:

```sh
npm run current-games:worker   # node dist/workers/current-game-worker.js
```

Run the HTTP API and the worker as independent deployable units (separate
containers/services) so they can be scaled, restarted, and rolled back
independently. See `docs/production/live-game-worker.md` for the worker's
startup, shutdown, and multi-instance-safety behavior, and
`docs/production/rollback.md` for what "never migrate backward" means for
`prisma:deploy`.

## Liveness vs. readiness, and the load-balancer probe caveat

- `GET /api/v1/health` — **liveness**. Reports process health only (uptime,
  timestamp). It never checks the database or any external provider, so a
  database outage does not fail liveness and does not trigger a
  process restart/replacement loop.
- `GET /api/v1/ready` — **readiness**. Runs one lightweight
  `SELECT 1`-equivalent Prisma query and returns `200` with
  `{status: 'ok', checks: {database: true}}` when it succeeds, or `503` with
  `{status: 'degraded', checks: {database: false}}` when it doesn't. It never
  calls Highlightly or Resend — only the database is checked.

Point load-balancer/orchestrator liveness probes at `/health` and readiness
probes at `/ready` (if the platform distinguishes the two); if it only
supports one probe, prefer `/ready` so instances that can't reach the
database are taken out of rotation.

**Operational consideration:** both endpoints are mounted behind the same
general `RATE_LIMIT_*` limiter as the rest of `/api/v1` — they are not
special-cased or exempted. A load balancer or orchestrator polling either
endpoint frequently (e.g. every few seconds from multiple instances) counts
against that shared rate limit alongside real API traffic. Size
`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` with health-check frequency in mind,
or reduce probe frequency, to avoid a health check itself tripping the rate
limiter.

## Fixture-data safety

`FIXTURE_DATA_ENABLED` gates whether fictional/development game fixtures are
publicly servable. It **must be `false` in production** — this is validated
at config load time (`NODE_ENV=production` + `FIXTURE_DATA_ENABLED=true`
throws `EnvironmentValidationError` and the process refuses to start). There
is no way to accidentally serve fixture data in a production deployment
without explicitly bypassing config validation.

## See also

- `docs/production/live-game-worker.md` — the long-running current-game
  worker: why it exists, startup/shutdown behavior, failure resilience,
  multi-instance safety, and how to verify it's alive.
- `docs/production/email.md` — the `EmailService` abstraction, Resend
  configuration, and the reset-email delivery-failure policy.
- `docs/production/contact.md` — the public contact form, its validation and
  rate limiting, and the admin triage API.
- `docs/production/rollback.md` — rollback plan for frontend, backend, and
  database, including the Neon branch/restore-point process that still needs
  to be confirmed with a human operator before the first production
  migration.
