# Current-game statistics synchronization

Milestone 22.5 adds a manual, provider-neutral current-game team box-score path. It is separate from nflverse historical statistics and does not participate in Stats Hub season aggregation.

## Storage

`CurrentGameTeamStat` stores exactly one home and one away row per game. Typed nullable columns cover only directly verified team totals plus Q1-Q4 and two overtime scores. Database uniqueness on `(gameId, teamId)` and `(gameId, isHome)` prevents duplicates. Nonnegative and conversion/attempt constraints protect factual invariants.

Private metadata records the source provider and synchronization timestamp. An atomic apply upserts only changed rows and writes one private `CURRENT_GAME_DETAILS_SYNC` audit. Raw payloads, unresolved player identities, scoring descriptions, and play strings are not stored.

Historical `PlayerGameStat` is deliberately not reused: it requires stable internal players, nflverse game/week/source-row semantics, and feeds historical aggregations. Current-game team rows cannot be mislabeled as nflverse or leak into Stats Hub.

## Commands

```text
npm run games:current:details:verify -- --gameId=<internal-uuid>
npm run games:current:details:sync -- --gameId=<internal-uuid> --dry-run
npm run games:current:details:sync -- --gameId=<internal-uuid> --apply
```

The service requires an existing verified game/provider mapping. It fetches one detailed match and one player box score, verifies provider game ID and home/away abbreviations, normalizes team/period/player capability fields, and batch-resolves player external IDs without N+1 queries.

Dry-run performs all fetch, validation, identity, read, and comparison work without mutation. Apply is allowed only under the existing M22 evaluation/publication policy. In production, Highlightly mutation remains blocked unless `HIGHLIGHTLY_PUBLICATION_APPROVED=true`.

Player rows are currently reported as unmatched and persisted as zero rows. The sync never creates `Player` records or external mappings and never uses names as identity.

Milestone 22.6 adds an opt-in reconciliation stage to this same command. Existing provider mappings are resolved first; only unmapped player IDs request profiles. Strong deterministic matches and sufficiently complete genuinely new-player profiles can plan private mappings and typed `CurrentGamePlayerStat` rows. Ambiguous/unresolved rows are omitted and reported privately. See [player-identity-reconciliation.md](player-identity-reconciliation.md).

## Public API

`GET /api/v1/games/:gameId/stats` reads PostgreSQL only. It returns home/away team totals and scoring by period, plus a provider-neutral limitation indicating that player statistics are unavailable pending identity reconciliation.

When reconciled rows exist, the same endpoint groups them by home/away and passing, rushing, receiving, defense, kicking, punting, and returns. Players use internal UUIDs and may appear in multiple categories. Neutral coverage metadata reports provider, resolved, and unresolved row counts without identifying the provider or unresolved players.

The response exposes internal game/team UUIDs only. It omits provider identity, provider IDs, source timestamps, audits, raw responses, player names, and unresolved player metadata. A game without a complete stored home/away pair returns `GAME_STATS_NOT_FOUND`.

## Semantics and limitations

- Values describe this game only; no historical, season, or career aggregation occurs.
- Recorded zero is factual. Missing provider data remains null.
- Team totals are not derived from player rows.
- Scoring events and textual play-by-play remain deferred.
- No scheduler, polling, worker, queue, WebSocket, SSE, frontend, or animation was added.
- Production publication remains blocked pending written Highlightly rights confirmation.

## Hosted verification

Verified August 8, 2026 against internal game `0768c441-16a6-457c-b50f-e7273d750d77` and its existing Highlightly mapping `565788`:

- Read-only verification and dry-run each used two provider requests. The dry-run planned two creates and performed no writes.
- First approved POC apply created the home and away rows in one transaction and one private audit. Arizona remained home; Carolina remained away.
- Repeating the identical apply returned two unchanged rows, performed zero database writes, and did not create a second audit.
- Provider player rows were `82 received / 0 matched / 82 unmatched / 0 ambiguous / 0 persisted`.
- `GET /api/v1/games/:gameId/stats` returned `200` with Arizona totals of 425 yards (282 passing, 143 rushing) and period scores `0, 17, 3, 10`; Carolina totals of 378 yards (237 passing, 141 rushing) and period scores `0, 17, 0, 16`.
- The public response contained no provider IDs, source metadata, unresolved player data, or raw payload.

Preservation checks remained at 2,024 games, 330 games for 2026, 25,766 players, 276,063 weekly roster rows, 112,316 historical player-game stat rows, and 1,959 game-provider mappings. The new table contains exactly two rows for the target game and the detail sync has exactly one audit.

## Performance

The first hosted apply used two provider calls and measured 376 ms provider time, 476 ms database read time, 54 ms batched player-identity lookup, less than 1 ms comparison time, 167 ms transactional database write time, and 1,074 ms total. The idempotent replay measured 486 ms provider time, 505 ms database read time, 62 ms identity lookup, 0 ms database write time, and 1,053 ms total.

The built public API's first measured request completed in 580 ms. Five subsequent requests measured 118-206 ms with a 159 ms median. These are observational hosted POC measurements, not load-test guarantees. The batched player lookup avoids N+1 queries; no additional index was justified by this single-game workload.

## Provider rights posture

Highlightly remains evaluation/POC-only. This milestone does not approve it as the primary provider, does not enable scheduling or live polling, and does not weaken the production mutation gate. Public DTOs intentionally omit provider attribution while publication/storage/transformation rights remain awaiting written confirmation. No logos or raw provider payloads are stored.

## Quality verification

The final local run passed 323 tests with 39 intentionally skipped, lint, strict TypeScript checking, formatting, build, Prisma validation, and `git diff --check`. The hosted database reports 11 committed migrations and is up to date. The runtime-only dependency audit reports zero vulnerabilities. The full development-tree audit still reports one high-severity advisory in `nanoid@3.3.16`, pulled transitively through the Vitest/Vite/PostCSS test toolchain; no runtime package depends on it, and this milestone did not alter dependency versions to mask an unrelated toolchain finding.
