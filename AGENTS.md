# Engineering Instructions

## Purpose and scope

This repository contains the backend for the 2nd and 15 consumer NFL web application. These instructions apply to the entire repository unless a more specific `AGENTS.md` is added in a subdirectory.

Before changing code, read:

1. `docs/product-brief.md`
2. `docs/architecture.md`
3. `docs/mvp-roadmap.md`
4. The files and tests in the feature being changed

Keep the current milestone small. Do not implement future product ideas merely because the architecture mentions them.

## Product invariants

- The backend exposes a versioned REST API under `/api/v1`.
- Frontend clients consume normalized domain models, never a sports provider's raw response shape or identifiers.
- Internal `Team.id` values are the stable keys used by users and other product data.
- Provider identifiers belong in `TeamProviderMapping` and must not become foreign keys in product-facing models.
- Internal `Game.id` values are public game keys; provider game IDs belong only in `GameProviderMapping`.
- Internal `Player.id` values are public player keys; provider/site player IDs belong only in `PlayerExternalIdentifier` and names must never be used as identity.
- Public player/stat requests query PostgreSQL only. They must never download nflverse files or expose external IDs, raw rows, checksums, paths, actors, or conflict metadata.
- Historical missing statistics remain null and distinct from factual zero values.
- Public game fields resolve editorial overrides before normalized base values; provider synchronization must never delete or overwrite override rows.
- Public registration always creates role `USER`; administrative capabilities come from the current persisted role, never request input or stale token claims.
- Audit and provenance metadata, internal editorial notes, and actor snapshots must remain private to authorized administrative routes.
- Public article routes expose only derived-visible published/scheduled content; drafts, unpublished, archived, revisions, actor snapshots, and audit data remain private.
- Curated articles store attribution and original summaries/commentary only. Never copy third-party article bodies or fetch source/image URLs automatically.
- News candidates are private metadata-only records. Feed ingestion must never fetch article pages/images, auto-publish, or change a candidate's editorial state.
- Public game queries without an explicit season must be constrained to `CURRENT_NFL_SEASON`; historical seasons require an explicit query.
- Development fixture games must remain hidden unless `FIXTURE_DATA_ENABLED` is explicitly enabled.
- A user may have zero or one favorite team during the MVP.
- A favorite team must exist and be active when it is assigned.
- Team asset metadata must retain its source and external URL. Do not assume that an asset may be copied or stored locally.
- Paid contests, wagering, and cash prizes are outside the MVP.

## Architecture rules

Use a modular, feature-based structure under `src/modules`. Keep framework code at the edges:

- Routes define paths, middleware, and handlers.
- Controllers translate HTTP input/output and remain thin.
- Zod schemas validate all untrusted request data at the boundary.
- Services contain use-case and business logic.
- Repositories contain Prisma persistence queries.
- Provider adapters translate external or fixture data into normalized sports types.
- Shared middleware, errors, logging, and response helpers live under `src/common` only when genuinely shared.

Do not import Express request or response types into services, repositories, or provider interfaces. Do not put Prisma calls, password hashing, token issuance, or provider normalization directly in route handlers.

Preferred dependency direction:

`route -> controller -> service -> repository/provider`

Lower layers must not import higher layers. Avoid cross-module access to another module's repository; expose an intentional service or public module interface instead.

## TypeScript and code style

- Use strict TypeScript and preserve all strict compiler checks.
- Do not use `any`. Prefer precise types, `unknown` at trust boundaries, and narrowing through Zod or type guards.
- Prefer small, named functions and explicit return types on exported functions.
- Use dependency injection for services, repositories, clocks, token utilities, and provider implementations where it improves testability.
- Avoid hidden global state and import-time side effects.
- Do not silently catch errors. Handle an expected condition explicitly or allow the centralized error handler to process it.
- Use the repository's configured formatter and linter. Do not introduce a second formatting or testing tool.
- Add comments for non-obvious intent or constraints, not to narrate straightforward code.

## API conventions

- All public endpoints live below `/api/v1`; the initial endpoints are listed in `docs/architecture.md`.
- Validate path parameters, query parameters, headers when applicable, and JSON request bodies.
- Return JSON using the shared response envelopes documented in `docs/architecture.md`.
- Use stable machine-readable error codes. Do not expose stack traces, database details, provider payloads, or sensitive authentication information.
- Use appropriate status codes: `201` for registration, `200` for successful reads/updates/login/refresh, `204` for logout when no response body is needed, `400` for malformed input, `401` for missing or invalid authentication, `404` for missing resources, `409` for conflicts, and `429` for rate limiting.
- Keep OpenAPI schemas and endpoint documentation synchronized with behavior in the same change.
- Changes to a published response shape are API changes; update tests and documentation deliberately.

## Authentication and security

- Hash passwords with a deliberately configured password-hashing library; never encrypt or log plaintext passwords.
- Use short-lived JWT access tokens and server-tracked, revocable refresh sessions.
- Persist only a one-way hash of each refresh token, not the raw token.
- Persist only a one-way hash of each password-reset token. Reset tokens are single-use and must never appear in normal logs or API responses.
- Rotate refresh tokens on successful refresh. Revoke the relevant session on logout and reject expired or revoked sessions.
- Keep token secrets, database credentials, provider keys, and other secrets server-side and out of version control.
- Commit `.env.example` with placeholder values only. Validate environment variables at process startup and fail fast with useful, non-secret errors.
- Redact authorization headers, cookies, passwords, and tokens from logs.
- Apply stricter rate limits to registration, login, and refresh endpoints than to ordinary reads.
- Apply the strictest authentication limit to forgot-password requests and preserve identical public responses for known and unknown emails.
- Use generic authentication failures where extra detail would help account enumeration.
- Treat fixture and provider data as untrusted input and validate it before normalization or persistence.

## Database and Prisma

- Make schema changes through committed Prisma migrations; do not rely on untracked schema pushes for shared development.
- Use database constraints for durable invariants such as unique normalized email addresses and unique provider mappings.
- Store timestamps in UTC.
- Select only required fields, especially for users; password hashes and token hashes must never be returned from general user queries.
- Use a transaction when a use case makes multiple writes that must succeed or fail together.
- Seed teams idempotently using stable internal identifiers or another documented stable key. Re-running a seed must not create duplicate teams or mappings.
- Synchronize games idempotently through provider mappings, resolve teams to internal IDs, and never delete games solely because a provider response omits them.
- Schedule imports must be bounded, validated, dry-run capable, idempotent, and audited; source URLs are metadata and must never be fetched automatically.
- Historical imports must validate committed manifests, checksums, schema drift, identities, teams, and games before writes; require explicit `--write`; use bounded transactions; retain source row hashes; and never modify the reviewed 2026 schedule.
- Raw historical files stay outside PostgreSQL and Git. Only small manifests, schemas, mappings, and review reports are version controlled.
- Version-controlled factual schedule datasets must pass `schedule:review` before write approval. An officially TBD kickoff uses CSV `TBD`, nullable `Game.startTime`, and public `startTime: null`; never convert a date-only or midnight placeholder into a factual kickoff.
- Article mutations must use optimistic concurrency, create immutable numbered revisions transactionally, and write compact audits without duplicating large bodies.
- News-source fetching must reject private/local/metadata destinations after DNS resolution and on every redirect, enforce byte/time/entry/depth limits, and retain only bounded RSS/Atom metadata.
- Review migration SQL before committing it. Never edit an already-applied migration to change production history; add a new migration.

## Sports data providers

- Code against the `SportsDataProvider` interface, not a concrete provider, outside the provider composition layer.
- Provider adapters own provider authentication, transport details, retries/timeouts, input validation, and normalization.
- The mock provider reads local fixture data and remains the default for tests, offline development, and fixture seeding.
- The API-Sports provider key is `api-sports`; its credential is supplied by `SPORTS_API` and must never be logged, committed, or exposed through API/OpenAPI contracts.
- API-Sports may be called only by explicit synchronization or opt-in verification commands, never by public request handlers.
- Provider evaluations are read-only, sanitized, credential-free, and stored under `docs/provider-evaluations/`; unavailable and untested capabilities must not be presented as verified.
- Evaluation-only Highlightly code must remain outside provider composition and persistence; it must not become an active `SportsDataProvider` without a separately approved milestone.
- A normalized record may carry an internal ID where the domain already has one; provider IDs must remain explicit mapping metadata and must not masquerade as internal IDs.
- Preserve attribution and asset-source metadata required by provider terms.
- Keep API-Sports logo storage disabled unless provider terms have been reviewed and `API_SPORTS_STORE_LOGO_URLS` is explicitly enabled.

## News-source inbox

- Only explicit admin-configured RSS, Atom, or manual-only sources belong in the registry; never infer team feed URLs.
- Manual submission and candidate conversion never fetch the candidate URL.
- Stable source IDs and canonical URL hashes drive idempotent duplicate prevention; refreshes preserve review state.
- Team suggestions are deterministic and advisory. Only editor-confirmed internal team IDs become article tags.
- Ingestion is manual through protected HTTP or the bounded CLI. Do not add cron, queues, workers, webhooks, headless browsers, scraping, or AI writing without a separately approved milestone.

## Errors, logging, and observability

- Use typed application errors for expected failures and one centralized Express error handler.
- Log requests with a request/correlation ID, method, path, status, and duration.
- Avoid request or response body logging by default because bodies may contain credentials or personal data.
- Log unexpected errors with enough context to investigate, while redacting secrets and avoiding duplicate logging at every layer.
- Health checks should distinguish process health from dependency readiness if readiness checks are added later.

## Testing expectations

- Every business rule needs a service-level test, including inactive or nonexistent favorite teams.
- Every route needs representative success, validation failure, authentication failure, and relevant not-found/conflict tests.
- Test provider normalization against fixture data without network access.
- Test factual schedule datasets with aggregate invariants plus targeted offset, DST, alias, stable-reference, and international-game samples; do not add one test per row.
- Test historical data with synthetic Parquet fixtures, missing-versus-zero rules, identity conflicts, team/game mapping, summary aggregation, dry-run no-write behavior, idempotency, schema drift, and public DTO privacy; standard tests must not require live nflverse downloads.
- Test refresh rotation, revocation, expiration, and reuse behavior once authentication is implemented.
- Tests must be deterministic: inject or control time, randomness, and IDs when relevant.
- A bug fix should include a regression test that fails before the fix.
- Run the narrowest relevant tests while iterating, then the full lint, typecheck, test, and build checks before handing off a milestone.

## Change discipline

- Inspect the worktree before editing and preserve unrelated user changes.
- Keep commits and changes scoped to one milestone or concern.
- Do not install a dependency unless it is needed by the approved milestone. Explain additions that affect security, runtime behavior, or architecture.
- Do not modify application code while a milestone is awaiting explicit approval.
- Update relevant documentation when a decision, invariant, endpoint, environment variable, or developer workflow changes.
- Do not claim an endpoint, test, migration, or integration is complete until it exists and has been verified.

## Definition of done for an implementation milestone

A milestone is complete only when its scoped behavior is implemented, validation and errors are covered, OpenAPI documentation reflects exposed endpoints, relevant tests pass, lint/typecheck/build checks pass, environment examples are current, and no secrets or generated artifacts are committed.
