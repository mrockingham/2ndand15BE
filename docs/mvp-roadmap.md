# MVP Roadmap

## Delivery approach

Build the first vertical slice in small, approval-gated milestones. Each milestone should leave the repository runnable or verifiable and should not silently absorb later roadmap items.

No application implementation existed when this roadmap was created.

## Milestone 0 — Product and engineering foundation

**Status:** Documentation drafted; implementation not started.

Deliverables:

- Product scope and success criteria
- Backend architecture and API conventions
- Durable repository instructions
- Milestone plan and explicit open decisions

Exit criteria:

- Owner approves the first implementation milestone and resolves only the decisions that materially affect it.

## Milestone 1 — Runnable service foundation

**Status:** Implemented on July 28, 2026. Automated application checks pass; starting the supplied PostgreSQL Compose service was not verified in the implementation environment because Docker was unavailable.

Goal: establish a small, testable service shell and reproducible local environment.

Deliverables:

- Node.js/TypeScript project scaffolding with pinned runtime and package manager metadata
- Strict TypeScript, ESLint, Prettier, and selected test runner
- Express `app.ts`/`server.ts` separation
- Zod-validated environment configuration and `.env.example`
- Docker Compose configuration for local PostgreSQL
- Prisma 7 configuration, generated-client plumbing, and PostgreSQL connectivity foundation; domain models and migrations are deferred to their feature milestones
- Central error/404 handling, request IDs, redacted request logging, and basic rate-limit plumbing
- `GET /api/v1/health`
- Initial OpenAPI document and health-route tests
- Developer setup/run/test instructions in `README.md`

Exit criteria:

- A clean checkout can follow the documented setup.
- Invalid environment configuration fails clearly.
- Prisma schema validation and client generation succeed against the model-free foundation.
- Health, lint, typecheck, test, and build checks pass.

Explicitly excluded: domain models, migrations, team fixture import, registration, sessions, login, and profile behavior.

## Milestone 2 — Normalized team catalog

**Status:** Implemented and verified on July 28, 2026 against the configured hosted PostgreSQL database. The migration applied successfully, two consecutive seeds completed with 32 teams, and read-only database integration checks confirmed 32 active teams and 32 unique mock mappings.

Goal: deliver stable internal NFL team records from a mock provider.

Deliverables:

- `SportsDataProvider` contract and normalized team types
- Validated local NFL team fixture and mock provider implementation
- Idempotent import/seed into `Team` and `TeamProviderMapping`
- Team repository and service
- `GET /api/v1/teams`
- `GET /api/v1/teams/:teamId`
- OpenAPI schemas and unit/service/route tests
- Fixture provenance notes, with external logo source metadata or null assets where rights are unclear

Exit criteria:

- Re-running the seed/import creates no duplicates.
- Public responses contain internal IDs and no raw provider shape or mapping IDs.
- Only active teams appear in the collection unless an explicitly documented query is later introduced.
- Not-found and validation behavior match the API error format.

## Milestone 3 — Authentication lifecycle

Goal: provide secure account creation and renewable, revocable sessions.

Status: complete.

Deliverables:

- Registration with normalized unique email and securely hashed password
- Login with safe credential failure behavior
- Short-lived JWT access tokens
- Hashed, expiring, rotating refresh sessions
- Refresh and logout endpoints
- Authentication middleware
- Tighter authentication rate limits
- Current-user endpoint
- Generic forgot-password and single-use reset-password flow
- Replaceable email abstraction with safe in-memory development/test provider
- OpenAPI schemas and security-focused service/route tests

Exit criteria:

- Registration, login, current-user access, refresh rotation, expiration, revocation, logout, and password reset are tested.
- Duplicate email behavior is stable and documented.
- Raw passwords and tokens are absent from persistence queries, API errors, and logs.
- The frontend has an agreed refresh-token transport and CORS/CSRF contract.

## Milestone 4 — User personalization slice

Goal: complete the backend contract needed by the first personalized home.

**Status:** Implemented and verified on July 29, 2026 against the configured hosted PostgreSQL database, including foreign-key, index, replacement, clearing, and `ON DELETE SET NULL` behavior.

Deliverables:

- `PATCH /api/v1/users/me/favorite-team`
- Favorite-team existence and active-status enforcement
- User DTO with normalized favorite-team information
- Transactional behavior where the implementation requires it
- OpenAPI schemas and business-rule/route tests

Exit criteria:

- An authenticated user can set or change one favorite team.
- A missing or inactive team cannot be assigned.
- An unauthenticated client cannot change favorite-team state.
- The current-user response never exposes password or refresh-session fields.
- The separately maintained frontend can implement its personalized-home bootstrap from the documented contract.

## Milestone 5 — Vertical-slice hardening

Goal: validate the slice as a coherent release candidate before adding sports features.

Deliverables:

- End-to-end happy-path coverage across team listing, registration/login, favorite selection, current user, refresh, and logout
- Fresh-database migration and idempotent seed verification
- OpenAPI review against actual responses
- Security/log-redaction review
- Dependency and error-path review
- Deployment/runbook notes appropriate to the selected host

Exit criteria:

- All automated quality gates pass in a production-like configuration.
- Known limitations and deferred work are recorded.
- No commercial provider credential or integration is required for the slice.

## Later roadmap themes

After the first slice is stable, define separate milestones for:

- Schedule, game, score, standings, and statistics normalization
- Commercial sports-provider adapter, caching, quotas, and failover
- News ingestion, attribution, deduplication, and AI summaries
- Predictions, model/version provenance, calibration, and historical accuracy
- Low-latency play-by-play delivery and visualizer event contracts
- Team/player/injury/transaction views
- Sleeper import and fantasy recommendations
- Additional followed teams and richer personalization

Each theme needs product acceptance criteria and data licensing review before implementation.

## Decisions and blockers

### Resolved foundation decisions

The owner approved:

- Node.js 24 LTS and npm
- ESM module format
- Vitest
- Argon2id, with bcrypt only as a deployment-compatibility fallback

Milestone 1 implementation was then approved.

### Resolved authentication and personalization decisions

- Access tokens are JWTs with a default lifetime of approximately 15 minutes and are returned in the response body.
- Database-backed refresh sessions default to approximately 30 days; only token hashes are stored.
- Refresh tokens use rotating `HttpOnly` cookies and are never stored in local storage.
- Individual-session revocation and current-session logout are required; the model must accommodate logout-all-devices later.
- Registration immediately creates an authenticated session.
- Credentialed CORS is configured through validated environment variables, and production cookies use secure settings.
- A user may clear a favorite team with `favoriteTeamId: null`; every non-null favorite must be an active team.

The deployment-specific frontend/backend origins and resulting `SameSite`/CSRF posture remain required configuration before authentication is deployed, but do not block the service foundation.

### External decisions deferred beyond this slice

- Commercial sports-provider selection, license, quota, attribution, and caching terms
- Rights/provenance for logos and other team assets
- Production host, secret manager, database operations, and telemetry vendor
- AI model/vendor and the editorial/provenance policy for summaries and predictions

These do not block mock-backed MVP development. Unlicensed assets should remain external with source metadata or be omitted until rights are clear.
