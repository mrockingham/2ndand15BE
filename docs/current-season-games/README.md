# Current-season game updates

Milestone 22 adds a manual, update-only pipeline for refreshing mutable state on an existing reviewed game. It does not create games, change the baseline schedule, run from a public request, or schedule background work.

The temporary provider is selected explicitly with `CURRENT_GAME_PROVIDER=highlightly`. Highlightly is permitted only for proof-of-concept, development, and staging evaluation under the current approval. Set `HIGHLIGHTLY_EVALUATION_MODE=true` and leave `HIGHLIGHTLY_PUBLICATION_APPROVED=false`. A production write is rejected unless a later rights review explicitly authorizes publication and the approval flag is then set to `true`.

## Commands

Commands accept either an existing internal UUID or a bounded reviewed-schedule week/date window. Verification and dry-run fetch provider data and read PostgreSQL but do not mutate it.

```text
npm run games:current:verify -- --gameId=<internal-uuid>
npm run games:current:sync -- --gameId=<internal-uuid> --dry-run
npm run games:current:sync -- --gameId=<internal-uuid> --apply
npm run games:current:sync -- --season=2026 --seasonType=PRE --week=1 --dry-run
npm run games:current:sync -- --season=2026 --seasonType=PRE --week=1 --apply
```

The apply command is intentionally manual. There is no cron, queue, worker, polling loop, webhook, or public-route provider call.

Reports include sanitized internal identity, coverage/outcome counts, intended field changes, matching method, mapping intent, provider-only records, bounded request count, and provider/matching/database/total timing. They never include credentials or raw payloads. Completed games also report independent team-stat results; the weekly path never requests or writes player data.

Milestone 25 semantics and hosted results are in [sync-hardening.md](sync-hardening.md), [provider-coverage.md](provider-coverage.md), and [team-stat-coverage.md](team-stat-coverage.md). The sourced admin-only omission path and provider reconciliation rules are in [result-fallback.md](result-fallback.md). Week 1 result coverage is now complete, while current-season team-stat API readiness remains **PARTIALLY_READY**.

Completed-game structured play ingestion, deterministic identity, reconciliation safeguards, and the provider-neutral public feed are documented in [play-by-play.md](play-by-play.md).

The bounded, operator-run live-validation diagnostic harness (M26.2) is documented in [live-validation.md](live-validation.md). The production active-game poller (M27) — centralized scheduling, featured-game rules, durable poll state, multi-instance locking, and live `GamePlay` persistence before `FINAL` — is documented in [active-game-poller.md](active-game-poller.md); it is disabled by default via `CURRENT_GAME_POLLER_ENABLED=false`.

The operator review and repair path for a blocked play reconciliation (M27.1) — diagnostics, conservative non-destructive repair modes, durable block visibility, and the admin API/CLI — is documented in [play-reconciliation-review.md](play-reconciliation-review.md).

The batched public Current Season Stats contract, availability semantics, and coverage classifications are documented in [current-season-stats-api.md](current-season-stats-api.md).

See [provider-verification.md](provider-verification.md) for evidence and rights posture, [sync-semantics.md](sync-semantics.md) for matching and update rules, and [performance-report.md](performance-report.md) for hosted timings. Box-score evidence and operations are documented in [box-score-capabilities.md](box-score-capabilities.md), [game-stats-sync.md](game-stats-sync.md), and [player-identity-reconciliation.md](player-identity-reconciliation.md).
