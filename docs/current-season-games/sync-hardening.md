# Current-game sync hardening

Milestone 25 keeps the reviewed internal schedule authoritative while using Highlightly only for mutable current-state enrichment. It never creates a `Game`, changes internal week/kickoff/orientation/neutral-site/provenance, deletes an omitted game, or invokes player reconciliation.

## Matching and normalization

Matching is mapping-first. Without a mapping, season, season type, home team, away team, and kickoff must match deterministically. An exact kickoff wins; otherwise the maximum tolerance is 15 minutes and ambiguity is rejected. Provider preseason `week=null` is intentionally ignored, so the reviewed internal week remains unchanged. `WSH` is normalized to the internal `WAS` alias.

Highlightly `SCHEDULED`/`PREGAME` records with `0 - 0` and clock `0` are normalized to null scores and a null clock. Live and final 0-0 values remain factual zeros. Existing status mappings cover scheduled, pregame, in-progress, halftime, final, postponed, canceled, and suspended states.

Provider omissions are reported as `UNMATCHED` with the reason `Provider omitted this reviewed internal game.` They cause no write, cancellation inference, deletion, or schedule reconciliation. Provider-only records are reported separately.

## Bounded operations

Single-game commands remain supported. Week and date-window scopes select only games with reviewed `OFFICIAL_WEB`, `MANUAL_IMPORT`, or `MANUAL_ENTRY` provenance.

```text
npm run games:current:sync -- --gameId=<uuid> --dry-run
npm run games:current:sync -- --season=2026 --seasonType=PRE --week=1 --dry-run
npm run games:current:sync -- --season=2026 --seasonType=PRE --week=1 --apply
npm run games:current:sync -- --season=2026 --seasonType=PRE --from=<ISO> --to=<ISO> --dry-run
```

Date ranges require both endpoints and cannot exceed 31 days. The adapter makes one bounded season request; provider-mapping ownership is resolved in one database query rather than per game. Each changed game remains an atomic game/mapping/audit transaction.

Completed matches additionally use the existing detail normalizer to upsert two `CurrentGameTeamStat` rows. Team-only mode requests no box score or player profiles and performs no `Player`, `PlayerExternalIdentifier`, `CurrentGamePlayerStat`, coverage, historical `PlayerGameStat`, or roster write. A team-stat failure is reported separately and cannot roll back or block the game-state result.

Each successful detail report classifies normalized team data as `COMPLETE`, `PARTIAL`, or `UNAVAILABLE`, validates home/away row orientation, and reports non-null counts for every stored field. Weekly output aggregates those classifications and field counts. Recorded zero is present data; null remains unavailable/not applicable. See [team-stat-coverage.md](team-stat-coverage.md) for the hosted measurements and readiness gate.

## Idempotency and future reuse

An identical replay uses existing mappings and returns `UNCHANGED`; pure no-ops create neither writes nor audits. The same `sync(gameId)` matching path remains suitable for a later explicitly approved poller, but Milestone 25 adds no polling, scheduler, cron, queue, WebSocket, SSE, or play-by-play behavior.

## Rights gate

Highlightly's terms were re-reviewed on August 21, 2026. Section 6.1 permits use, distribution, transfer, and storage of API data in applications/products, while prohibiting resale, sublicensing/direct API redistribution, and proxy/pass-through services. Section 6.2 prohibits systematic extraction for a competing database/service. Visual assets remain the application's responsibility under sections 6.3-6.4.

The conservative `HIGHLIGHTLY_PUBLICATION_APPROVED` production-write gate remains. Development/staging evaluation requires `HIGHLIGHTLY_EVALUATION_MODE=true`; production mutation still requires an explicit operator rights approval. Raw payloads, provider IDs, credentials, and audits remain private, and logo/image assumptions are unchanged.
