# Current-season game updates

Milestone 22 adds a manual, update-only pipeline for refreshing mutable state on an existing reviewed game. It does not create games, change the baseline schedule, run from a public request, or schedule background work.

The temporary provider is selected explicitly with `CURRENT_GAME_PROVIDER=highlightly`. Highlightly is permitted only for proof-of-concept, development, and staging evaluation under the current approval. Set `HIGHLIGHTLY_EVALUATION_MODE=true` and leave `HIGHLIGHTLY_PUBLICATION_APPROVED=false`. A production write is rejected unless a later rights review explicitly authorizes publication and the approval flag is then set to `true`.

## Commands

All commands require an existing internal UUID. Verification and dry-run fetch provider data and read PostgreSQL but do not mutate it.

```text
npm run games:current:verify -- --gameId=<internal-uuid>
npm run games:current:sync -- --gameId=<internal-uuid> --dry-run
npm run games:current:sync -- --gameId=<internal-uuid> --apply
```

The apply command is intentionally manual. There is no cron, queue, worker, polling loop, webhook, or public-route provider call.

Reports include sanitized outcome counts, intended field changes, matching method, mapping intent, bounded request count, and provider/matching/database/total timing. They never include the provider key or raw payload.

See [provider-verification.md](provider-verification.md) for evidence and rights posture, [sync-semantics.md](sync-semantics.md) for matching and update rules, and [performance-report.md](performance-report.md) for hosted timings. Box-score evidence and operations are documented in [box-score-capabilities.md](box-score-capabilities.md), [game-stats-sync.md](game-stats-sync.md), and [player-identity-reconciliation.md](player-identity-reconciliation.md).
