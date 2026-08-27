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

## Milestone 5 — NFL schedules and normalized game catalog

Goal: add the first real football-content domain without coupling public contracts to a sports-data vendor.

**Status:** Implemented and verified on July 31, 2026 against the configured hosted PostgreSQL database. The migration, two-pass idempotent seed, database integration suite, HTTP smoke tests, quality gates, production build, and dependency audit passed.

Deliverables:

- Normalized `Game` and `GameProviderMapping` persistence
- Constrained season types and game statuses
- Validated, explicitly fictional development schedule fixture
- Idempotent synchronization with team-mapping resolution and structured outcomes
- Public filtered/cursor-paginated game list, single-game, and team-games endpoints
- UTC date handling, bounded defaults, OpenAPI documentation, and database coverage

Exit criteria:

- Repeated fixture synchronization preserves internal IDs and updates mutable fields.
- Provider mappings never appear in public DTOs.
- List filters, bounds, pagination, errors, and team convenience reads are verified.
- Migrations, hosted persistence checks, quality gates, and HTTP smoke tests pass.
- No commercial provider credential or integration is required.

## Milestone 6 — API-Sports NFL synchronization

Goal: synchronize real NFL teams and schedules without changing public API contracts or coupling request handlers to the provider.

**Status:** Implemented and verified on August 1, 2026. Mocked and full quality gates passed; the configured hosted database retained 32 unique teams, added 32 API-Sports team mappings and 256 normalized 2024 regular-season games, and repeated synchronizations were idempotent. Read-only HTTP checks confirmed source isolation and private provider metadata. The configured provider plan rejected 2025 and exposed no 2026 records, so current-season synchronization remains provider-plan/data-blocked rather than being treated as a successful populated sync.

Deliverables:

- Validated API-Sports NFL team/game adapter behind `SportsDataProvider`
- Timeout, abort, bounded-retry, rate-limit, safe-error, and credential-redaction behavior
- Deterministic matching of API-Sports teams to the existing internal 32-team catalog
- Idempotent real-game synchronization through private provider mappings
- Explicit provider factory and source-isolated public game reads
- Manual team/game/combined sync and opt-in read-only live verification commands
- Mocked provider coverage and operational documentation

Exit criteria:

- API-Sports response envelopes and records are validated without leaking raw payloads.
- Existing teams receive mappings without duplication or unwanted display-field replacement.
- Real games preserve internal IDs, resolve internal teams, and update mutable fields idempotently.
- Mock remains the default and fictional games are excluded when API-Sports is selected.
- Quality gates, safe live verification, and configured hosted-database checks are reported.
- Scheduling, polling, play-by-play, and other future sports domains remain deferred.

## Milestone 6.1 — Current-season and provider-evaluation safety

Goal: prevent historical or fictional games from being presented as current data and establish a read-only evaluation boundary for future provider decisions.

**Status:** Completed and verified on August 1, 2026.

Deliverables:

- Explicit validated current NFL season and historical-default policy
- Fixture visibility controlled independently from provider selection
- Empty current-season defaults when the selected source has no current games
- Explicit historical-season queries preserved without DTO changes
- Provider-neutral evaluation report schema, findings, and sanitized renderer
- API-Sports historical/current suitability report under `docs/provider-evaluations/`
- Credential scans, safety regression tests, and HTTP verification

Exit criteria:

- Historical 2024 API-Sports games never appear in a default 2026 query.
- Fixture games are hidden unless explicitly enabled.
- Public responses remain normalized and provider-private.
- Evaluation reports distinguish verified, unavailable, and untested capabilities.
- No credential or credential header appears in tracked evaluation output.
- All quality and hosted verification gates pass.

## Highlightly NFL provider evaluation

Goal: evaluate Highlightly's 2026 NFL schedule, game detail, play events, statistics, standings, operational behavior, and licensing constraints without implementing an adapter or touching persisted data.

**Status:** Complete on August 1, 2026. The live read-only evaluation passed current-season schedule suitability with warnings; Highlightly is not approved as the primary provider pending written data-publication, storage, transformation, and logo-rights confirmation.

Boundaries:

- Evaluation-only configuration and HTTP client
- Official documentation and OpenAPI version recorded
- Eight-request maximum per evaluation run with a two-request early stop when 2026 is absent
- Explicit runtime schemas and sanitized coverage analysis
- No Prisma, synchronization, mappings, migration, active-provider, or public API changes

## Milestone 7 — Administrative schedule stewardship

Goal: make PostgreSQL the editorial source of truth for NFL schedules without coupling corrections to one sports provider.

**Status:** Complete on August 2, 2026. The hosted migration, fictional dry-run/write/idempotency import, HTTP smoke, and full verification gates passed.

Deliverables:

- `USER`, `EDITOR`, and `ADMIN` roles with current-role capability checks
- Safe audited role-promotion CLI for existing users
- Game provenance and factual verification metadata
- Separate one-per-game editorial overrides with field-by-field public resolution
- Provider-sync preservation and hidden-base-update summaries
- Bounded CSV/JSON schedule validation, dry-run, deterministic matching, and idempotent import
- Protected administrative schedule, override, verification, import, and audit endpoints
- Immutable-style sanitized administrative audit history

Boundaries:

- No administrative frontend, score override, scraping, scheduled sync, or media ingestion
- Highlightly remains evaluation-only
- Public game DTOs and provider identifiers remain unchanged

Exit criteria:

- Existing users migrate to `USER`, registration cannot assign roles, and authorization boundaries are tested.
- Fictional imports are dry-run verified, applied once, and skipped idempotently on repeat.
- Provider mappings survive imports and sync; editorial overrides retain precedence.
- Migration, hosted checks, HTTP smoke tests, OpenAPI, documentation, and all quality gates pass.

## Milestone 9 — News and editorial CMS

Goal: provide a secure PostgreSQL-backed editorial source of truth for original, curated, and announcement content without adding a third-party CMS or automated ingestion.

**Status:** Complete on August 2, 2026. The hosted migration, fictional lifecycle and visibility smoke, cleanup verification, full Neon integration suite, and quality gates passed.

Deliverables:

- Constrained article types and draft/scheduled/published/unpublished/archived lifecycle
- Safe normalized Markdown and HTTP(S)-only source/image metadata
- Active internal-team tagging and deterministic featured placement
- Version-based optimistic concurrency and immutable transactional revisions
- Compact `ARTICLE` administrative audits without duplicated bodies
- Editor article management and admin-only archive/restore operations
- Public list, detail, featured, and team-article endpoints with private-field isolation
- Derived scheduled visibility without cron, queues, workers, or GET-time mutations

Boundaries:

- No CMS frontend, uploads, image proxying, scraping, RSS/news API ingestion, or copied third-party bodies
- No AI drafts/summaries, notifications, Redis, jobs, or provider synchronization
- Existing authentication, sports, schedule administration, and public contracts remain backward compatible

Exit criteria:

- Hosted constraints, joins, status transitions, concurrency, revisions, visibility, and audits pass.
- A fictional draft exercises publish/unpublish/archive/schedule behavior and is cleaned up.
- Unauthorized/editor/admin HTTP boundaries and public privacy behavior pass.
- OpenAPI, documentation, migrations, full tests, build, dependency audit, credential scan, and diff checks pass.

## Milestone 11 — Verified 2026 NFL schedule baseline

Goal: prepare, review, and import a provider-independent 2026 preseason and regular-season schedule from official factual sources.

**Status:** Complete on August 2, 2026, with the Hall of Fame schedule-stewardship addendum completed on August 8, 2026. The committed baseline validates 49 preseason games (including the Hall of Fame Game as `PRE` with a null week) and all 272 regular-season rows. NFL.com omits concrete kickoff times for four Week 16 games, four Week 17 games, and all 16 Week 18 games; ESPN independently labels the same 24 kickoffs TBD. The approved explicit-TBD policy stores no invented time: CSV `TBD` becomes nullable `Game.startTime` and public `startTime: null`.

Delivered while blocked:

- Exact-contract `data/schedules/nfl-2026.csv` with all 321 represented official rows
- Read-only `schedule:review` aggregate validation and targeted dataset tests
- Canonical team abbreviations, stable human-reviewable references, official provenance, and normalized network labels
- Explicit review of all nine international games, the domestic neutral-site Hall of Fame Game, and DST/UTC samples
- Human-readable source, count, missing-field, warning, import, API, and preservation report
- Nullable-kickoff migration and public/OpenAPI semantics for honest TBD representation
- Clean 320-row dry run; first write created 320 and identical second write skipped 320
- Hosted counts, provenance, audits, provider mappings, overrides, CMS/auth/session preservation, public API privacy, pagination, and fixture isolation checks

The Hall of Fame Game uses the null-week convention: Carolina at Arizona, `PRE`, neutral site in Canton, and initially `SCHEDULED` with null scores. NFL.com's source identity is `PRE 0`, but the established database constraint accepts only weeks 1-22 or null, so null avoids both a schema migration and folding the game into Preseason Week 1. The 24 TBD rows require later editor updates and human verification after official kickoff assignment. Current status and score synchronization remains Milestone 22 work.

Milestone 22A imported the Hall of Fame row once and skipped it on the identical second import. Hosted counts moved from 2,023 to 2,024 total games and from 329 to 330 games in 2026, while provider mappings and unrelated product data were preserved. Existing game, team-game, and Team Hub reads returned the new internal game exactly once. Milestone 22 may resume at bounded provider verification/dry-run against that stable internal identity.

## Milestone 22 — Current-season game update pipeline

Goal: safely update mutable current-game state on one existing reviewed internal game through a provider-neutral, manual, dry-run-first pipeline.

**Status:** Implemented and hosted proof-of-concept verified on August 8, 2026. API-Sports returned no target record. Highlightly returned the exact Hall of Fame Game with Arizona home, Carolina away, a 30-33 score, and Finished state. Dry-run planned the exact update, first apply updated one existing game and added one mapping, and repeat apply was unchanged. Public reads and both Team Hubs reflected the final without exposing provider metadata; game counts remained 2,024 total and 330 for 2026. Highlightly remains approved only for development/staging evaluation; production mutation requires separate publication approval.

Deliverables:

- Explicit current-game provider and Highlightly evaluation/publication configuration guards
- Bounded Highlightly adapter into the normalized game contract
- Exact-ID, update-only service with mapping-first and reviewed-schedule fallback matching
- Dry-run reports, atomic state/mapping/private-audit writes, and idempotent repeat apply
- Unit coverage for normalization, scores, statuses, identity/orientation, ambiguity, collision, rollback, and rights enforcement
- Hosted game/list/Team Hub verification, preservation counts, timing report, and full regression gates

Boundaries:

- No game creation, baseline schedule changes, public provider calls, automatic failover, logo storage, cron, queue, worker, webhook, or production deployment
- No provider identifiers, payloads, credentials, audit data, or evaluation metadata in public DTOs
- No production Highlightly publication without a separate written rights decision

## Milestone 22.5 — Current game box score and team statistics

Goal: discover Highlightly game-detail capability and persist only safely normalized, provider-neutral, game-specific statistics.

**Status:** Complete on August 8, 2026. Hosted verification, dry-run, one atomic apply, idempotent replay, public API verification, preservation checks, and performance measurement passed. Discovery found strong team totals and quarter scoring plus 82 player rows. Player publication remains deferred because no stable Highlightly player mappings exist and the provider supplied no positions.

Deliverables:

- Sanitized capability matrix for team/player stats, period scoring, scoring events, and play records
- Separate typed `CurrentGameTeamStat` storage with private source provenance and no nflverse contamination
- Two-request manual detail synchronization with batch player identity checks and existing M22 production guard
- Dry-run-first, atomic, idempotent team-row upserts and private audit
- Provider-private `GET /api/v1/games/:gameId/stats` for team totals and period scoring

Boundaries:

- No name-based player identity, unresolved-player persistence, scoring-description parsing, public play-by-play, season aggregation, scheduling, polling, animation, or provider promotion

## Milestone 22.6 — Current player identity and game player box scores

Goal: reconcile current provider player identities deterministically and expose only safely resolved, game-specific player box scores.

**Status:** Local implementation complete; hosted reconciliation is safely blocked on August 9, 2026 by the Highlightly account request quota. Sixty-three of 82 profiles returned with strong identity fields, while 19 remained unavailable. No hosted migration, player, mapping, player-stat, coverage, or audit mutation was applied.

Deliverables:

- Existing-mapping-first reconciliation with exact DOB/position matching, controlled missing-DOB fallback, collision rejection, and no name-only or fuzzy binding
- Safe transactionally created current players only when no internal candidate exists and the provider profile has game-team, position, DOB, and jersey/draft evidence
- Separate typed `CurrentGamePlayerStat` and neutral coverage storage with no historical nflverse or Stats Hub contamination
- Existing detail CLI extended for dry-run/apply, private review output, quota-paced profile calls, and zero-profile-call mapped repeats
- Provider-private public home/away category arrays using internal player UUIDs only

Boundaries:

- No hosted apply until all 82 profiles are available and the complete dry-run passes the ambiguity gate
- No fuzzy automatic match, mass catalog/roster import, historical aggregation, 2026 Stats Hub, provider promotion, polling, scheduling, or frontend work

## Milestone 25 — Current-game sync hardening and preseason backfill

Goal: treat the reviewed schedule as authoritative while safely enriching bounded current-game windows from incomplete, week-null Highlightly data.

**Status:** Complete on August 21, 2026. Dry-run-first hosted Week 1 and Week 2 backfills applied 15 verified finals, preserved 14 upcoming games with null scores, reported three provider omissions without destructive action, synced 30 team-stat rows, and passed identical no-write replays. All 15 stored final-game pairs were core-complete and correctly oriented, but Week 1 provider coverage was only 13/16; current-season team-stat API readiness is therefore `PARTIALLY_READY`, with provider coverage/fallback hardening selected as the next gate.

Deliverables:

- Mapping-first/exact-first deterministic matching with a 15-minute maximum kickoff tolerance and explicit ambiguity/orientation rejection
- Preseason provider-null week handling, internal-week preservation, WSH/WAS alias normalization, and scheduled 0-0/clock placeholder removal
- Game/week/date bounded update-only CLI with reviewed-provenance selection, provider-missing/provider-only coverage, sanitized internal identity, and batch mapping ownership checks
- Independent completed-game team-stat-only enrichment with no player requests or player/historical mutations
- Hosted coverage, fallback, rights, performance, preservation, public API, and idempotency verification
- Reusable COMPLETE/PARTIAL/UNAVAILABLE team-stat classifier with per-field coverage reporting and a documented API-readiness decision

Boundaries:

- No new games, schedule reconciliation/deletion, inferred missing scores, player reconciliation/stats, play-by-play, polling, cron, scheduler, queue, WebSocket, SSE, new provider, or frontend work

## Milestone 25.1 — Reviewed result fallback and provider reconciliation

Goal: prevent provider-omitted reviewed games from remaining result-stale while preserving schedule authority and keeping score coverage separate from statistical coverage.

**Status:** Complete on August 21, 2026. Three official NFL Week 1 finals passed dry-run, were applied through sourced editorial overrides, and returned unchanged on exact replay. Week 1 result coverage is 16/16; team-stat coverage remains 13/16, so only per-game available statistics are safe and aggregate rankings remain incomplete.

Deliverables:

- Final-only admin/editor result fallback on existing reviewed games with source, reason, actor, server verification time, private/public notes, and append-only audit
- Editorial result precedence in public Games and Team Hub APIs without exposing fallback internals
- Provider agreement/disagreement/still-missing reconciliation with conflict-safe mapping behavior
- Independent result/stat coverage reporting and a bounded hosted coverage command
- Prediction evaluation against resolved editorial final results

Boundaries:

- No game creation, fabricated team stats, Current Season Stats API, play-by-play, provider scraping/activation, prediction-model change, player reconciliation, polling, cron, queue, WebSocket, SSE, or frontend work

## Milestone 23 — AI editorial assistant and media candidates

Goal: reduce launch editorial preparation through original, attributed, human-reviewed drafts without scraping or automatic publication.

**Status:** Hosted verification completed through the required three-candidate sample on August 9, 2026. Both additive migrations are deployed, M22.6 reconciliation data remains untouched, the OpenAI configuration is explicit, and conservative source rights are seeded. Three private drafts were generated; two required safe thin-source remediation and the third exposed an NCAA-only editorial-relevance gap. The additional batch was correctly skipped because the individual-sample acceptance gate was not met.

Deliverables:

- Provider-neutral editorial AI boundary with optional OpenAI structured-output adapter and graceful unconfigured behavior
- One-candidate generation, ten-candidate bounded batch generation, and versioned unpublished-draft regeneration
- Existing `Article`/revision/candidate/audit reuse with private confidence, risk, prompt, token, timing, and review metadata
- Exact internal team resolution, conservative context-aware player suggestions, deterministic duplicate classification, and source phrase-overlap safeguards
- Reviewed source-rights profiles, external-reference-only media candidates, and fail-closed media attachment
- All-team launch coverage with duplicate/rejection-aware draft counts and separate candidate availability
- OpenAPI, environment validation, focused tests, and `docs/editorial-ai/`

Boundaries:

- No auto-publishing, arbitrary page fetching, autonomous ingestion, automatic YouTube search, media downloading/rehosting, scheduled generation, cron, worker, queue, social/newsletter/push delivery, frontend work, or game/player-provider changes
- Public article DTOs remain unchanged and exclude all AI, duplicate, rights, unresolved-entity, usage, timing, and audit metadata

## Milestone 23.1 — Candidate quality gate and launch discovery

Goal: prevent unsafe or irrelevant AI generation and expand launch discovery only through reviewed, bounded source mechanisms.

**Status:** Completed through the hosted pilot gate on August 9, 2026. The additive migration and 22-candidate re-evaluation succeeded; the NCAA-only candidate is rejected, all existing authorized material is link-only, and 29 of 31 final evaluations were deterministic. The bounded ESPN RSS pilot created nine metadata candidates but produced no opportunity for its four target teams, so full 32-team discovery was correctly stopped.

Deliverables:

- Persisted private deterministic-first NFL relevance, authorized-source sufficiency, duplicate, quality-factor, and generation-eligibility decisions
- Compact structured AI fallback only for deterministic uncertainty with separate classification usage accounting
- Full-draft and 40-120 word short-brief provider modes with no-padding constraints
- First-generation blocking for non-NFL, duplicate, insufficient, manual-review, and link-only decisions
- Audited quality override that cannot change rights or publish
- One/50-candidate admin evaluation routes, enhanced 32-team coverage, configurable source preference, and OpenAPI
- Sequential approved-feed launch discovery with 1-30 day freshness, global 320 maximum, dynamic gap priority, four-team pilot, partial-failure reporting, and no article generation

Boundaries:

- No full discovery after a failed pilot, paid/search provider activation, inferred team feeds, arbitrary crawling, HTML/article/image fetching, auto-publication, media rehosting, scheduled jobs, or Highlightly changes
- Private quality, classifier, rights, source-query, duplicate, and audit metadata remains absent from public APIs

## Milestone 24 — AI Hub weekly predictions foundation

Goal: provide reproducible, provider-neutral weekly NFL predictions with immutable revisions, explicit publication, and honest historical evaluation.

**Status:** Complete on August 9, 2026. The additive migration is deployed; two chronological backtest samples passed sanity gates; one private Hall of Fame retrospective and three pre-kickoff published preseason POC snapshots were verified; public privacy, audit, idempotency, performance, preservation, and all regression gates passed.

Deliverables:

- Deterministic `baseline-v1` Elo plus historical team-stat model with strict pre-kickoff cutoffs
- Immutable prediction revisions, private feature/availability provenance, explicit publish/lock/evaluate lifecycle, accuracy and Brier reporting
- Dry-run-first single-game and maximum 20-game weekly generation, chronological backtest CLI, null-week retrospective support
- Optional team-level OpenAI explanation that cannot alter numerical outputs and fails independently
- Public list/detail/summary/performance routes, admin generation/publication/evaluation routes, cache policy, OpenAPI, tests, and `docs/ai-hub/`

Boundaries:

- No frontend, fantasy advice, betting/odds, injuries, depth charts, weather, scheduling, cron, queue, worker, provider call, or ML training
- Public DTOs exclude feature snapshots, availability internals, actors, audits, provider metadata, prompts, tokens, and timing

## Milestone 24.1 — AI Hub Tier 1 weekly intelligence

Goal: compose honest, reproducible weekly game and team intelligence from existing published prediction snapshots without creating a second prediction source of truth.

**Status:** Complete on August 9, 2026. All 16 hosted Week 1 snapshots produced deterministic Tier 1 output; two team filters, public privacy, zero-record performance, idempotence, query bounds, and quality gates passed without a database mutation.

Deliverables:

- Deterministic strongest, closest, upset-watch, blowout, projected-total, and confidence rankings
- Supported offense, defense, and turnover-profile comparisons plus an optional favorite-team view
- Same-model evaluated season and previous-week performance with honest zero/null handling
- One bounded public endpoint, five-minute cache policy, OpenAPI, formula documentation, and regression coverage

Boundaries:

- No new database model, player intelligence, fantasy or betting advice, injuries, depth charts, weather, provider calls, AI calls, scheduling, cron, queues, or workers
- Raw feature snapshots, availability internals, provider IDs, prompts, tokens, timings, actors, and audits remain private

## Milestone 13 — Controlled news-source inbox

Goal: discover candidate NFL stories from explicitly approved RSS/Atom feeds or editor-supplied URLs without scraping, copying full text, or bypassing the existing CMS workflow.

**Status:** Complete on August 2, 2026. The migration applied to Neon, the full hosted integration suite and local quality gates passed, the fictional end-to-end workflow cleaned up, and no live source was inserted by default.

Deliverables:

- Admin-managed `RSS`, `ATOM`, and `MANUAL_ONLY` source registry with private health/run history
- Manually triggered SSRF-resistant, timeout/byte/redirect/depth/entry-bounded feed reads
- Strict SAX parsing, plain-text descriptions, stable external-ID/canonical-URL deduplication, and conditional requests
- Private candidate inbox with deterministic advisory team suggestions and terminal-aware review states
- Manual metadata submission without page fetching
- Transactional conversion to an existing `CURATED` `DRAFT`, revision 1, and compact CMS/candidate audits
- Protected HTTP operations and a sequential five-source-bounded CLI

Boundaries:

- No frontend, article-page/image fetching, full-text storage, automatic publication, AI writing/tagging, social ingestion, cron, queue, worker, webhook, Redis, or production deployment changes
- No inferred team feeds and no default active source without a documented live evaluation

## Milestone 15 — Historical player identity and statistics foundation

Goal: establish local player profiles, weekly rosters, weekly performances, and deterministic season totals for 2020-2025 using reviewed nflverse core releases.

**Status:** Complete on August 3, 2026. The additive migration and all six seasons are applied to Neon. The full review accepted 415,111 of 415,251 source rows with 726 documented warnings and zero failures; every identifiable player, game, team, and opponent mapped. Regular-season reconciliation found zero mismatches across 12,027 player summaries and 27 fields.

Deliverables:

- Stable internal player UUIDs with private, conflict-checked external identifier mappings
- Week-level roster/team history and controlled wide player-game statistics
- Factual 2020-2025 game identities isolated through nflverse provider mappings
- Deterministic `REG`, `POST`, and `REG_POST` season summaries
- Checksummed manifests, Parquet schema-drift detection, validation/reconciliation reports, and database-size measurements
- HTTPS/host/redirect/time/byte-bounded downloader and dry-run-default, explicit-write, season-selectable importer
- Minimal public player list/detail/weekly/season API with bounded pagination and private DTO boundaries
- CC BY 4.0 attribution, field-selection guide, pilot report, and complete import guide

Boundaries:

- No play-by-play, participation, snaps, injuries, depth charts, contracts, betting, predictions, AI, vectors, frontend work, live polling, cron, queues, Redis, or production deployment changes
- Public HTTP requests query PostgreSQL only and never download nflverse files
- Names never establish player identity; name-only and non-player aggregate rows remain excluded with warnings

## Milestone 17 — Stats Hub, leaderboards, and recent performance

Goal: expose trustworthy public historical player rankings and recent recorded performances from the normalized 2020-2025 PostgreSQL dataset.

**Status:** Implemented and verified on August 5, 2026. The conservative 20-metric registry, metadata, season/team-split leaderboards, weekly leaders, and one-player recent summaries passed unit and hosted Neon pilot checks. Representative database plans stayed below the 250 ms review target without a new index.

Deliverables:

- Versioned metric allowlist with five stable categories and no client-selected SQL fields
- Dynamic imported-season/position metadata and source attribution
- Competition-ranked season leaderboards with stable opaque cursor continuation
- Player/team season aggregation that handles traded players honestly
- Distinct weekly game/team performance rows with opponent and internal game context
- Bounded one-player recent values and null-aware descriptive aggregates
- Public historical cache headers, OpenAPI, metric/API guides, and Neon plan review

Boundaries:

- No live 2026 stats, rate/fantasy metrics, predictions, recommendations, AI, play-by-play, frontend work, new provider, Redis, queue, cron, worker, or production deployment change
- Public requests remain PostgreSQL-only and expose no provider IDs or import metadata

## Milestone 19 — Public Team Hub APIs

Goal: give the frontend a stable, efficient team-page backend by composing existing public team, schedule, editorial, roster, and Stats Hub behavior.

**Status:** Implemented and verified on August 5, 2026. Team Hub route/database checks passed for AFC and NFC samples, all non-live hosted regression suites passed, representative plans met their review targets without a new index, and preservation counts remained unchanged. Details are in `docs/team-hub/performance-review.md`.

Deliverables:

- Compact active-team overview with up to three stored 2026 upcoming games, three final games, and three derived-visible article cards
- Separate factual roster/stat season coverage, historical default season, positions/groups, limitations, and nflverse attribution
- Required-season historical roster with one internal player per team-season, optional position/group/search filters, bounded opaque cursor pagination, and explicit weekly-membership semantics
- Team-scoped season leaderboard route that reuses the exact Stats Hub metric, aggregation, ranking, null/zero, tie, cursor, and error contract
- Public cache policies, OpenAPI, Team Hub guides, hosted query-plan review, and preservation checks

Boundaries:

- No inferred or provider-fetched 2026 roster/stat data, injuries, depth charts, transactions, standings, new provider calls, scraping, background jobs, Redis, frontend work, or production deployment changes
- No external player/provider IDs, raw rows, source paths, checksums, import actors, editorial internals, or invented kickoff times
- Existing independently paginated team games and team articles remain available and unchanged

## Later roadmap themes

After the first slice is stable, define separate milestones for:

- Standings and additional team-statistics normalization
- Additional sports-provider adapters, distributed caching, quotas, and failover
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
