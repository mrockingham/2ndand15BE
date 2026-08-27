# Current-game provider verification

Date: August 8, 2026

Target internal game: `0768c441-16a6-457c-b50f-e7273d750d77` — 2026 preseason, Carolina Panthers at Arizona Cardinals, August 7 at 00:00 UTC, neutral site at Tom Benson Hall of Fame Stadium.

## Provider findings

API-Sports returned no record for the target in the read-only verification and cannot safely supply this update.

Highlightly returned match `565788` with the exact kickoff and orientation: Arizona home, Carolina away. Its state was Finished and its score string was `30 - 33`, interpreted as Arizona home score 30 and Carolina away score 33. The normalized result is therefore `FINAL`, `homeScore=30`, and `awayScore=33`.

The current-game adapter made one bounded, authenticated list request per command, received 49 season records, validated the one in-window candidate, and retained no raw response. Verification and explicit dry-run both returned `WOULD_UPDATE`, schedule matching, no ambiguity, and the changes `SCHEDULED -> FINAL`, `homeScore null -> 30`, `awayScore null -> 33`, `quarter null -> 4`, and `clock null -> "0"`.

The first hosted apply returned `updated=1` and created the verified Highlightly mapping. The second returned `updated=0`, `unchanged=1`, used `PROVIDER_MAPPING`, and made no further write. One private evaluation-mode audit exists.

Public game detail, bounded game listing, and both team-game lists returned the internal game exactly once as Arizona home, Carolina away, `FINAL`, 30-33. Carolina and Arizona Team Hubs each returned it zero times in upcoming and once in recent. Public serialization contained neither `highlightly` nor `565788`.

Post-apply preservation was 2,024 total games, 330 games in 2026, one 2026 preseason CAR-at-ARI game, 1,959 total provider mappings (one more than the 1,958 pre-apply count), and one reviewed provenance row on the target. Final unrelated-table counts were 32 teams, 25,766 players, 276,063 weekly roster rows, 112,316 player-game-stat rows, one news source, 22 news candidates, one article, and one user; the synchronization transaction contains no writes to those models. See [performance-report.md](performance-report.md) for timings.

The complete backend suite passed 309 tests with 39 environment-gated tests skipped. Six hosted-backed public HTTP checks covered game detail, the bounded listing, both team-game listings, and both Team Hubs. Lint, strict TypeScript, formatting, production build, Prisma validation, all 10 migration checks, and `git diff --check` passed. `npm audit` retained the previously known single high-severity transitive `nanoid <3.3.17` advisory; no dependency was changed in this milestone.

## Rights posture

Update, August 21, 2026: Highlightly's July 24, 2026 terms now expressly permit use, distribution, transfer, and storage of API data in applications/products, subject to restrictions on API resale/proxying and competing-database extraction. Visual rights remain the user's responsibility. The earlier August 8 wording below records the gate in force at that time; Milestone 25 retains the gate as an explicit conservative production control. See [sync-hardening.md](sync-hardening.md).

The Week 1/2 re-evaluation confirms that Highlightly remains an enrichment source rather than schedule authority: it omitted three reviewed Week 1 games. Stored final-game team-stat pairs were core-complete, but broader Current Season Stats readiness is only `PARTIALLY_READY`; see [provider-coverage.md](provider-coverage.md) and [team-stat-coverage.md](team-stat-coverage.md).

Milestone 25.1 subsequently resolved those three stale results from independently reviewed official NFL sources through the admin-only editorial fallback. Highlightly still has no mapping for them and their team statistics remain unavailable. See [result-fallback.md](result-fallback.md).

The owner has authorized Highlightly only as a temporary proof-of-concept current-game provider in development/staging evaluation mode. This is not approval for production publication, redistribution, logo storage, or general provider activation. `HIGHLIGHTLY_PUBLICATION_APPROVED` remains false. The service rejects production mutation in that state even if evaluation mode is enabled.

Provider IDs, raw payloads, credentials, mappings, and the evaluation-mode audit remain private. The adapter stores no logos or provider URLs and adds no attribution claim beyond the private synchronization audit. A separate written rights decision remains required before production use.
