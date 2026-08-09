# Current player identity reconciliation

Date: August 9, 2026

Milestone 22.6 extends the guarded current-game detail pipeline with deterministic player identity reconciliation. Highlightly remains evaluation/POC-only and the existing production mutation gate is unchanged.

## Live profile discovery

The Hall of Fame Game box score contains 82 unique Highlightly player IDs. The official API exposes single-ID `GET /players/{id}` profiles and a paginated/name-filtered catalog, but no targeted multi-ID bulk route. The full catalog was deliberately not downloaded.

A bounded sequential operation requested all 82 profiles. Sixty-three returned before the account exhausted its broader request quota; 19 remained unavailable. Retry-aware accounting recorded 101 physical profile requests because each rate-limited call retried once. Profile enrichment lasted 36,134 ms before the quota stop.

| Profile field  | Returned coverage |
| -------------- | ----------------: |
| Birth date     |                63 |
| Position       |                63 |
| Jersey         |                62 |
| Current team   |                63 |
| Draft metadata |                32 |
| Height         |                63 |
| Weight         |                63 |

No shared GSIS, ESPN, Sportradar, or other external identifier appeared in the runtime payload. The returned shape otherwise matched the documented family: name, birth date/place, dimensions, jersey, active state, position, draft metadata, and current team.

Because 19 profiles were unavailable, candidate-name counts, strong-match counts, ambiguity, genuinely absent players, and final unresolved totals cannot be established safely. No player/stat reconciliation was applied. This is a mandatory safety stop, not permission to fall back to names.

The M22.6 migration was separately reviewed for Milestone 23A, found strictly additive, and deployed on August 9, 2026. It creates empty player-stat/coverage tables, constraints, indexes, and foreign keys only. This schema-only deployment did not execute reconciliation and does not change this milestone's status. Highlightly mappings, current player-stat rows, newly created current players, and player-sync audits remain zero until the quota-gated dry-run is complete and explicitly applied.

## Identity hierarchy

Resolution is ordered and deterministic:

1. `EXISTING_MAPPING`: exact private `PlayerExternalIdentifier(provider, externalId)` lookup.
2. `SHARED_EXTERNAL_ID`: reserved for an exact overlapping identifier; current Highlightly profiles supply none.
3. `STRONG_PROFILE`: conservative full-name equivalence, exact birth date, and compatible position.
4. Missing-internal-DOB fallback: exact name, compatible position, game-team roster/latest-team evidence, and matching jersey, draft, or physical evidence.
5. `NEW_CURRENT_PLAYER`: no internal name or DOB candidate, verified game team, position, birth date, and jersey or draft-year evidence.

Name, jersey, position, team, and headshot are never sufficient alone. A conflicting birth date is rejected. Same-name collisions are `AMBIGUOUS`. Fuzzy similarity never creates a mapping. Suffixes remain identity-significant; punctuation and initial variants are candidate lookup only.

## Storage and transactions

The existing `Player` model and private `PlayerExternalIdentifier` mapping are reused. A provider-originated current player receives an internal UUID and only supported profile fields; it receives no invented nflverse ID, roster history, historical statistics, or career totals.

`CurrentGamePlayerStat` is a separate typed one-row-per-game/player model containing only fields verified in M22.5. `CurrentGamePlayerStatCoverage` stores neutral received/resolved/unresolved counts. Neither participates in historical imports, summaries, player history, or Stats Hub aggregation.

New Player creation, private mapping, player stat, coverage, and audit writes are transactional. Unique mapping and game/player constraints reject contradictory bindings. An identical repeat skips profiles for mapped IDs and performs zero writes when stats and coverage are unchanged.

## API and request cost

`GET /api/v1/games/:gameId/stats` can return home/away passing, rushing, receiving, defense, kicking, punting, and return arrays using internal Player UUIDs only. A player may appear in multiple categories. Unresolved provider rows are omitted, with neutral coverage metadata; provider IDs and reconciliation evidence remain private.

Profile IDs are deduplicated and mappings are resolved before enrichment. Only unmapped IDs are fetched, requests are paced, and profiles are cached within the operation. The first reconciliation is expensive; mapped repeats normally use zero profile calls beyond the two game-detail requests.

## Verification and blocker

Local verification passed 338 tests with 39 intentionally skipped, lint, strict TypeScript, formatting, build, Prisma validation, runtime dependency audit, and `git diff --check`. The complete development-tree audit retains the existing high-severity `nanoid@3.3.16` advisory through Vitest/Vite/PostCSS; runtime dependencies report zero vulnerabilities.

Post-deployment hosted counts remain 2,024 games, 330 games for 2026, 25,766 players, 276,063 weekly roster rows, and 112,316 historical player-game rows. Highlightly player mappings, current-game player-stat rows, coverage rows, and player-sync audits remain zero. Migration `20260809000100_add_current_game_player_stats` is applied; reconciliation data remains pending.

Resume the data workflow at a quota-refreshed `games:current:details:verify` for internal game `0768c441-16a6-457c-b50f-e7273d750d77`. Schema deployment alone is not permission to run this command. Do not apply reconciliation unless all 82 profiles receive final resolution outcomes and the private ambiguity review is acceptable.
