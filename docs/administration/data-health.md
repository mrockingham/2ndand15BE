# Data health (M29A)

Admins previously had no way to tell what current-season game data actually exists without querying the database by hand. `CurrentGamePlayerStat` was the largest pain point: when it is missing for a game, nobody could tell whether Highlightly never provided it, the backend failed to ingest it, player identity reconciliation blocked it, or the game simply had not reached that stage yet. The Data Health API answers this deterministically.

All routes are below `/api/v1/admin/data-health` and require `VIEW_DATA_HEALTH` (`EDITOR` and `ADMIN`) or, for the probe, `PROBE_GAME_DATA` (`ADMIN` only).

## DB-only vs. provider probe

`GET /games` (overview) and `GET /games/:gameId` (detail) are **strictly DB-only** -- zero Highlightly/provider HTTP requests, ever, regardless of what an admin does with the dashboard. `POST /games/:gameId/probe` is the **only** entry point that may call Highlightly, and it only runs when an operator explicitly clicks it. There is no automatic sweep: one probe click is one bounded investigation of one game. A probe never syncs scores, writes team stats, writes player stats, or writes plays -- it persists only its own sanitized diagnostic record (`GameDataHealthProbe`).

## Coverage states

`result`, `teamStats`, `playerStats`, and `plays` on the overview/detail response each carry a provider-neutral `state` describing what the database currently has:

- `COMPLETE` -- the database has what it should for this stage of the game.
- `PARTIAL` -- some data is present but incomplete (e.g. team-stat rows missing core fields, or unresolved player identities alongside stored rows).
- `MISSING` -- the game has reached a stage where this data is expected, but the database has none.
- `PENDING` -- the game has not yet reached a stage where this data is expected.
- `UNAVAILABLE` -- the game is in a terminal non-playing state (`POSTPONED`/`CANCELED`/`SUSPENDED`) or a prior sync already confirmed the provider has nothing.
- `UNKNOWN` -- reserved for states outside the classifier's coverage; should not occur in practice.

## Diagnosis codes and the `PROBE_REQUIRED` sentinel

Each section also carries a `reasonCode` drawn from one shared vocabulary per category (result / team stats / player stats / plays). Several of those codes -- `PROVIDER_NO_X`, `PROVIDER_HAS_X_DB_MISSING`, `PLAYER_IDENTITY_UNRESOLVED`, `RESULT_CONFLICT`, `PROVIDER_REQUEST_FAILED` -- describe what _the provider_ has, which is only knowable after a probe runs. The DB-only endpoints can only assign the subset of codes derivable from the database alone (`NOT_EXPECTED_YET`, `MISSING_PROVIDER_MAPPING`, the `*_COMPLETE`/`*_PARTIAL` codes, `RESULT_USING_EDITORIAL_FALLBACK`). When the database has zero rows for data that should exist and no prior probe has run for that game, the DB-only code is **`PROBE_REQUIRED`** -- an explicit "we don't know why yet, run the probe" signal, never a guessed provider-side code. Once a probe has run, its findings are cached on the game as `lastProbe` and surface in `lastProbe.playerStatsDiagnosis` etc. without spending another Highlightly request.

## Player-stat diagnosis codes

- `NOT_EXPECTED_YET` -- game hasn't reached `IN_PROGRESS`/`HALFTIME`/`FINAL`.
- `MISSING_PROVIDER_MAPPING` -- no `GameProviderMapping` row for `highlightly`.
- `PROVIDER_NO_PLAYER_STATS` -- Highlightly's box score has no player rows for either side yet.
- `PROVIDER_HAS_PLAYER_STATS_DB_MISSING` -- Highlightly has stats, the database has none. Likely ingestion/persistence gap.
- `PLAYER_IDENTITY_UNRESOLVED` -- some/all provider players don't resolve to internal players via an existing mapping.
- `DB_PLAYER_STATS_PARTIAL` -- Highlightly has more resolvable coverage than is currently persisted.
- `PLAYER_STATS_COMPLETE` -- database coverage matches what the probe found.
- `PROVIDER_REQUEST_FAILED` -- the bounded probe itself failed (network/timeout/rate-limit/malformed payload).

### Troubleshooting decision tree

1. Is `providerMapping.available` false? -> fix the mapping first; nothing else can be checked.
2. Is the game before `IN_PROGRESS`? -> `NOT_EXPECTED_YET`; wait.
3. Run the probe. Is `playerStats.providerAvailable` false? -> Highlightly has not published player stats yet; not a backend bug.
4. Is `playerStats.resolvedPlayers` > 0 but `playerStats.databaseRows` is 0 (or less than `resolvedPlayers`)? -> **ingestion/persistence gap** -- the production sync pipeline is not writing rows it should be able to write. This is the bug to chase.
5. Is `playerStats.unresolvedPlayers` > 0? -> identity reconciliation is the blocker for those specific players. See the bounded-probing caveat below before concluding a player is truly unresolvable.

### Bounded player-identity probing

Full production reconciliation (`current-player-reconciliation.ts`, invoked from `sync-current-game-details.ts`) fetches an individual Highlightly player profile per unmapped provider player to attempt `STRONG_PROFILE`/`NEW_CURRENT_PLAYER` resolution -- for a game with 25+ unmapped players that is 25+ additional, rate-limited Highlightly requests. The probe intentionally does not do this: it calls the exact same `reconcileCurrentPlayer` function but without a fetched profile, which by that function's own logic can only return `EXISTING_MAPPING` or `UNRESOLVED`. **The probe's `unresolvedPlayers` count is therefore an upper bound** -- it means "not yet linked by an existing mapping," not "cannot ever be resolved." A full backfill (`npm run games:current:details:backfill`) may still resolve some of these players via profile lookups. This keeps every probe fixed at exactly two Highlightly requests, independent of roster size.

## Team-stat diagnosis codes

`NOT_EXPECTED_YET`, `MISSING_PROVIDER_MAPPING`, `PROVIDER_NO_TEAM_STATS`, `PROVIDER_HAS_TEAM_STATS_DB_MISSING`, `DB_TEAM_STATS_PARTIAL`, `TEAM_STATS_COMPLETE`, `PROVIDER_REQUEST_FAILED`. Reuses `classifyCurrentGameTeamStats` (`current-game-team-stat-coverage.ts`) for the two-sided orientation/core-field completeness check already used by production sync.

## Result diagnosis codes

`RESULT_COMPLETE`, `RESULT_PENDING`, `PROVIDER_RESULT_MISSING`, `RESULT_USING_EDITORIAL_FALLBACK`, `RESULT_CONFLICT`, `PROVIDER_HAS_RESULT_DB_MISSING`, `PROVIDER_REQUEST_FAILED`, `MISSING_PROVIDER_MAPPING`. Editorial result fallback (`GameEditorialOverride`) always takes precedence, matching `docs/current-season-games/result-fallback.md`; the probe compares the provider's live status/score against the fallback and reports `RESULT_CONFLICT` rather than silently overwriting it. The probe never writes to `GameEditorialOverride` or the base `Game` row.

## Play diagnosis codes

`PLAYS_PENDING`, `MISSING_PROVIDER_MAPPING`, `PROVIDER_NO_PLAYS`, `PROVIDER_HAS_PLAYS_DB_MISSING`, `PLAYS_PARTIAL`, `PLAYS_COMPLETE`, `PLAYS_REVIEW_REQUIRED`, `PROVIDER_REQUEST_FAILED`. `PLAYS_REVIEW_REQUIRED` mirrors `CurrentGamePollState.playsReviewRequired` (M27.1 blocked-reconciliation state) and takes priority over any row-count comparison -- an admin should resolve the blocked review via the existing plays-diagnostic/repair endpoints before trusting a play count here. Respects M27.2 authoritative-FINAL-snapshot semantics: only active (`supersededAt: null`) `GamePlay` rows count toward `activeCount`.

## Provider request cost

A probe issues **exactly two** Highlightly requests: one shared `/matches/{id}` fetch (via `createHighlightlyMatchDetailFetcher`, the same fetcher the M26.2 live-validation harness uses) covering result identity, team stats, and plays, plus one `/box-score/{id}` fetch required specifically for player stats -- `normalizeHighlightlyCurrentGameDetails` cannot produce player rows without it. No diagnostic section issues its own separate request; every normalization step reuses the real production normalizer functions (`normalizeHighlightlyCurrentGameDetails`, `normalizeHighlightlyCurrentGamePlays`) against that one shared payload, never a parallel parser. If the game has no provider mapping, the probe makes zero requests. Sanitized quota telemetry (`x-ratelimit-requests-limit`/`-remaining`, already observed by the shared HTTP client) is included in every probe result and persisted alongside the diagnosis.

## What is never exposed

The overview/detail/probe responses never include a Highlightly provider game ID, provider player ID, raw provider JSON, or API credentials. `providerMapping` on the overview/detail endpoints is `{ available: boolean }` only.

## No automatic sweep

There is deliberately no "probe every missing game" bulk action in this milestone. The DB-only dashboard already scales via batched/grouped queries over the filtered slate (one `findMany` plus one `groupBy` for active play counts, not one query per game); a capped bulk-diagnostic feature can be added later once real usage patterns are observed.
