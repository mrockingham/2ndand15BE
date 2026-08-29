# M27: active-game poller

Milestone 27 replaces manual live-validation operation with a centralized, production-safe
backend poller. It discovers relevant current games, classifies each game's polling priority,
polls only when due, and writes normalized Game state, `CurrentGameTeamStat`, and live `GamePlay`
rows through the same M25/M22.5/M26 normalization and persistence used everywhere else in the
current-game pipeline. It does not add frontend polling, WebSockets, or SSE.

See [live-validation.md](live-validation.md) for the manual diagnostic harness this milestone
replaces for day-to-day operation; that harness remains available for bounded, operator-run
one-off checks and is unaffected by this poller.

## Architecture

- **Scheduler**: a single `CurrentGamePoller.runCycle()` (`src/modules/sports/current-game-poller.ts`)
  is invoked on a heartbeat. It does not run one timer per game. Each cycle:
  1. Discovers candidate games from PostgreSQL only (no provider calls yet).
  2. Ensures a `CurrentGamePollState` row exists for each candidate.
  3. Claims due, unlocked rows up to a bounded batch size.
  4. Runs one poll per claimed row, writing through the real M25/M22.5/M26 services/repositories.
  5. Recomputes each row's scheduling class and `nextPollAt` from the freshly observed state.
- **Priority engine**: `src/modules/sports/current-game-scheduling.ts` is a pure, provider-neutral
  module (`decideScheduling`, `classifyFeatured`) with no I/O — fully unit-testable, and reused
  identically by the poller. The scheduling classification (`GameSchedulingClass`) is a Prisma enum
  kept separate from `GameStatus`: a game can be internally `IN_PROGRESS` while its scheduling
  class is `LIVE_FEATURED`.
- **State persistence**: `CurrentGamePollState` (one row per game) survives process restarts —
  see [Durable state](#durable-state).
- **Locking**: a lightweight conditional-update claim (see [Multi-instance safety](#multi-instance-safety))
  — no Redis, no advisory locks, just ordinary Postgres row updates.
- **Enable switch**: `CURRENT_GAME_POLLER_ENABLED` (default `false`). The bounded CLI
  (`npm run current-games:poller`) can still run with the switch off via `--dry-run` or
  `--gameId=<uuid>` for debugging; a broad, write-capable, all-games run refuses to start
  unless the switch is `true`.

## Configuration

```env
CURRENT_GAME_POLLER_ENABLED=false
CURRENT_GAME_POLLER_HEARTBEAT_SECONDS=20
CURRENT_GAME_POLLER_BATCH_SIZE=10
CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS=120
CURRENT_GAME_PREGAME_POLL_SECONDS=300
CURRENT_GAME_LIVE_POLL_SECONDS=120
CURRENT_GAME_FEATURED_POLL_SECONDS=60
CURRENT_GAME_HALFTIME_POLL_SECONDS=180
CURRENT_GAME_FINAL_RECONCILE_10_MINUTES=10
CURRENT_GAME_FINAL_RECONCILE_60_MINUTES=60
CURRENT_GAME_RATE_LIMIT_DEGRADE_THRESHOLD=500
```

All are validated at startup by `loadCurrentGameSyncConfig` (`src/config/env.ts`); the +60 minute
reconciliation must be configured strictly after the +10 minute one. Nothing in the scheduler or
poller hardcodes an interval — every timing constant flows through `SchedulingPolicyConfig`.

## Intervals and scheduling classes

| Class                | Trigger                                             | Interval                                                |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `NOT_DUE`            | Not yet a candidate, or a terminal non-final status | none (or wakes exactly at kickoff − 10 min for pregame) |
| `PREGAME`            | Reviewed kickoff within the next 10 minutes         | 300s                                                    |
| `LIVE_NORMAL`        | `IN_PROGRESS`, not featured                         | 120s                                                    |
| `LIVE_FEATURED`      | `IN_PROGRESS`, featured (see below)                 | 60s                                                     |
| `HALFTIME`           | `HALFTIME`                                          | 180s                                                    |
| `FINAL_IMMEDIATE`    | First poll to observe `FINAL`                       | due immediately, same poll                              |
| `FINAL_RECONCILE_10` | Immediate pass done                                 | due at `finalObservedAt + 10 min`, once                 |
| `FINAL_RECONCILE_60` | +10 pass done                                       | due at `finalObservedAt + 60 min`, once                 |
| `COMPLETE`           | +60 pass done                                       | never again                                             |

The poller never detail-polls a game more than 10 minutes before kickoff — a pregame game's
`nextPollAt` is set to exactly `kickoff − 10 min`, not re-checked every heartbeat.

## Featured rules (V1)

Recalculated on every poll, in this precedence order:

1. **Manual override** (`Game.manualFeatured`, `true`/`false`/`null`) always wins, including an
   explicit "un-feature" (`false`) overriding national broadcast or a close game.
2. **National broadcast** — see `src/modules/sports/national-broadcast-networks.ts`. The
   allowlist is `NFL Network`, `ESPN`, `ABC`, `NBC`, `Prime Video`/`Amazon Prime Video`, `Netflix`.
   **FOX and CBS are deliberately excluded**: inspecting the 2026 schedule's `broadcastNetwork`
   values showed FOX on 95 games and CBS on 94 — those networks carry the regional Sunday-afternoon
   package (many simultaneous different games share the label), so treating either as "national"
   would feature nearly every Sunday game. Revisit only if the schedule model starts distinguishing
   a network's single national game of the week from its regional broadcasts.
3. **Close fourth quarter** — `quarter === 4` and both scores present and
   `abs(homeScore - awayScore) <= 8`. A game can drop back out of `LIVE_FEATURED` if it becomes a
   two-score game again and no other rule applies — this is recalculated fresh every poll, not
   sticky.

No active-viewer-based or traffic-based prioritization is implemented (excluded from this
milestone).

### Manual featured override

`Game.manualFeatured` / `manualFeaturedReason` / `manualFeaturedById` / `manualFeaturedAt` are
plain columns on `Game`, not part of `GameEditorialOverride`. They were deliberately kept
separate from that model: `GameEditorialOverride` mutations reset `GameProvenance.verifiedAt`
(they represent schedule/result corrections that require re-verification), and featuring a game
is an unrelated operational/curation decision that should never force a reviewed game back into
an unverified state.

```
PUT /api/v1/admin/games/:gameId/featured
{ "featured": true, "reason": "Close divisional game" }   // enable
{ "featured": false }                                       // explicitly un-feature
{ "featured": null }                                         // clear the override
```

Requires the `EDIT_SCHEDULE` administrative capability (same as the other schedule-editing
routes) and writes an `AdminAuditEvent` (`GAME_FEATURED_SET`) with before/after snapshots.

## Due scheduling

For each candidate the poller computes, purely from already-known data (no provider call):
current game status, kickoff, current time, last successful/attempted poll, current scheduling
classification, and next due time. `decideScheduling` (see above) is the single source of truth
for that computation; `PrismaCurrentGamePollStateRepository.claimDue` only ever asks "which rows
have `nextPollAt <= now`" — it never calls Highlightly.

## Discovery

`CurrentGamePollStateRepository.discoverCandidates` reads only PostgreSQL, bounded, every cycle:

- `status IN (IN_PROGRESS, HALFTIME)`, or
- `status IN (SCHEDULED, PREGAME)` and `startTime` within the next 10 minutes **or up to 4 hours
  in the past**, or
- `status = FINAL`, `startTime` within the last 24 hours, and (`no poll state row yet` or
  `final60CompletedAt IS NULL`).

The 24-hour bound on the FINAL branch is a discovery-query safety limit distinct from the +60
minute reconciliation deadline — without it, `pollState IS NULL` would match every historical
completed game ever imported and rescan the archive on every cycle.

The 4-hour backward bound on the SCHEDULED/PREGAME branch (`SCHEDULED_RECOVERY_LOOKBACK_HOURS`)
was added after a 2026-08-27 production incident: a worker started after a game's kickoff could
never discover it, because the branch originally only looked forward (`startTime >= now`). A game
whose provider status was never corrected past `SCHEDULED` — because no worker was running yet —
was invisible to discovery, and would have stayed that way forever without an operator manually
correcting it. This bound recovers it automatically on the next cycle after a worker (re)starts,
while still excluding genuinely stale/never-played historical `SCHEDULED` rows.

### Explicit `--gameId` recovery/debug polling

`--gameId=<uuid>` (see [Manual runs](#manual-runs)) does **not** filter discovery's output — it
bypasses `discoverCandidates` entirely and resolves the requested game directly via
`findCandidateGameById` (an unwindowed lookup), then claims it via `claimForRecovery` (the same
lock/lease safety as `claimDue`, but without requiring `nextPollAt <= now`). It still validates
the game exists and has a current-game provider mapping (throwing a clear error otherwise — a
regression from before this fix, when a `--gameId` outside discovery's window silently produced
zero candidates with no explanation) and still runs through the same
policy/evaluation/publication gate as every other tick. It cannot create a duplicate claim: a game
another worker currently holds an unexpired lock on is left alone, same as `claimDue`.

## Durable state

`CurrentGamePollState` (one row per `Game`, `onDelete: Cascade`):

```text
id, gameId, schedulingClass, featuredReason,
lastAttemptAt, lastSuccessAt, nextPollAt, lastObservedStatus, lastError,
finalObservedAt, finalImmediateCompletedAt, final10CompletedAt, final60CompletedAt,
lockedAt, lockedBy, createdAt, updatedAt
```

This is what lets a restarted process know, without any in-memory timers, when a game was last
polled and which final-reconciliation steps have already run. Restart recovery: an overdue live
game (`nextPollAt` already in the past) is picked up on the next heartbeat's claim query exactly
like any other due row — there is nothing restart-specific to recover.

## Multi-instance safety

`claimDue` uses a conditional-update claim, not `SELECT ... FOR UPDATE`:

1. Read candidate row ids where `nextPollAt <= now` and (`lockedAt IS NULL` or the lock is older
   than the configured lease).
2. For each candidate, attempt `UPDATE ... WHERE id = ? AND nextPollAt <= now AND (lockedAt IS
NULL OR lockedAt < staleBefore) SET lockedAt = now, lockedBy = workerId`.
3. Only a row where that `UPDATE` affected exactly one row was actually won; a competing instance
   racing the same row loses the update (its `WHERE` no longer matches) and simply claims nothing
   for that row this cycle.

No Redis or new locking infrastructure — ordinary Postgres row-level atomicity is sufficient at
this scale. `recordSuccess`/`recordFailure` always clear `lockedAt`/`lockedBy`, so a completed
(or failed) tick never leaves a row stuck locked; a crashed worker's lock simply expires after
`CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS`.

## Provider request strategy and budget

Each detailed live poll makes two baseline Highlightly HTTP requests: one current-state/schedule
lookup (M25) and one match-detail lookup shared by both team-stat and play observation (M22.5 +
M26) — the same request is never issued twice for those surfaces. When the independent
player-stat cadence is due, it adds exactly one `/box-score/{id}` request and reuses the match
detail for identity/orientation; it never repeats the match request. PREGAME makes no box-score
request, LIVE defaults to 120 seconds even when featured, HALFTIME refreshes on its normal tick,
and every FINAL reconciliation stage refreshes once. See
[the M38A report](m38a-live-box-score-and-recovery.md). This reuses the exact
optimization proven in the M26.2 live-validation harness (`src/modules/sports/highlightly-match-detail-fetcher.ts`
is the shared fetcher factory used by both the harness and the poller).

Every tick reports `gameId`, scheduling class, provider HTTP requests used (`requestUsageDelta`,
from the client's real request counter, so retries are included), duration, and per-surface
result. `CURRENT_GAME_RATE_LIMIT_DEGRADE_THRESHOLD` (default 500, tracked from the provider's
`x-ratelimit-requests-remaining` header) triggers graceful degradation rather than a hard stop:
claimed rows are still claimed and released cleanly, but only `FINAL_IMMEDIATE`,
`FINAL_RECONCILE_10`, `FINAL_RECONCILE_60`, `LIVE_FEATURED`, and any row on its very first-ever
poll (`NOT_DUE`, so a newly discovered game is never left unclassified) are actually polled;
`LIVE_NORMAL`, `PREGAME`, and `HALFTIME` rows are skipped and retried on their existing schedule.
See `shouldPollWhileDegraded` in `current-game-poller.ts`.

## Live write behavior

- **Game state**: reuses `CurrentGameSyncService.sync({ apply: true })` unmodified — reviewed
  schedule authority, editorial result-fallback precedence, and provider-conflict handling are
  all identical to the manual `games:current:sync` command.
- **Team stats**: reuses `normalizeHighlightlyCurrentGameDetails` + `toTeamStatWrite` +
  `classifyCurrentGameTeamStats`, writing through `CurrentGameDetailsRepository.applyStats`
  directly (bypassing `CurrentGameDetailsSyncService.sync`'s own separate fetch, which is exactly
  what keeps this at one shared match-detail request). Absence during part of a live game is not
  treated as an error, and null is never replaced with zero.
- **Player stats**: a due refresh calls only the narrow box-score fetcher, reuses the already
  fetched match detail, batch-resolves existing provider mappings, and writes only safely mapped
  `CurrentGamePlayerStat` rows plus neutral coverage. Recurring polling makes no player-profile
  requests and performs no name-only reconciliation. Missing fields remain null.
- **Live `GamePlay` (before FINAL only)**: the poller **may persist plays before FINAL** — this is
  the intended production path (superseding the diagnostic-only `--applyPlays` flag on the
  live-validation harness). It reuses `identifyPlays`, `reconcilePlays`, and
  `CurrentGamePlayRepository.applySnapshot` directly, the same M26 functions validated end-to-end
  against a live game (PHI @ NE, 2026 preseason week 2) during the M26.2 harness run. Rules are
  unchanged: new plays insert, deterministically matched corrections update safely, stable
  backend IDs are preserved, a provider snapshot shrinking never deletes stored plays (any
  unmatched-existing or collision blocks the entire write transactionally), and no raw provider
  payload is ever persisted. **Once the game is FINAL, plays no longer take this path at all** —
  see [Final reconciliation](#final-reconciliation) below.
- The Highlightly play adapter removes exact whole-drive mirrors before assigning play order.
  Highlightly can return the active drive both at index zero and again at its chronological tail
  position; the adapter retains the later exact copy. It never deduplicates individual plays,
  because repeated penalties, timeouts, and other factually distinct plays may share text or
  structure.
- The FINAL-gated manual command (`games:current:plays:sync`) is untouched — `CurrentGamePlaySyncService`'s
  FINAL-only gate was neither removed nor weakened. The poller never calls that service; it calls
  the repository/reconciliation functions directly, the same way the diagnostic harness already
  did.

## Final reconciliation

On the poll that first observes `FINAL`, the poller performs Game state + team stats in the same
work unit as before, and records `finalObservedAt`/`finalImmediateCompletedAt`. It then polls once
more at `finalObservedAt + 10 min` and once more at `finalObservedAt + 60 min`, then marks the row
`COMPLETE` and never polls that game again automatically.

**Plays are handled differently once FINAL** (M27.2): rather than reconciling the FINAL snapshot
against the live-polled rows, all three final-stage passes (`FINAL_IMMEDIATE`, `+10`, `+60`) treat
the provider's snapshot as **authoritative** and replace the active play set outright — see
[play-reconciliation-review.md](play-reconciliation-review.md#final-authoritative-snapshot-replacement-m272)
for the full validation, plausibility-guard, and fingerprint-based idempotency detail. Each pass
is naturally idempotent through that fingerprint comparison (an unchanged snapshot is a no-op, not
a repeat write) rather than through a `completedAt` timestamp guard — `final10CompletedAt`/
`final60CompletedAt` still gate _whether a pass runs at all_ on schedule, but a pass that does run
is always safe to repeat.

## Failure recovery

A failed poll for one game (timeout, rate limit, provider error, normalization error,
persistence error) is caught per-game inside the cycle's claim loop and never aborts the rest of
that cycle. `recordFailure` preserves all prior stored state, records a sanitized error message,
releases the row's lock, and schedules a retry (the shorter of the live/pregame interval) rather
than tight-looping.

## Plays blocked state (M27.1)

A blocked plays reconciliation (see [Live write behavior](#live-write-behavior) above — any
unmatched-existing row or structural collision blocks the entire write) is now a **durable,
operator-visible** fact rather than a transient in-memory one. `CurrentGamePollState` carries
three additional fields:

- `playsBlockedAt` — when the block first began. Preserved across repeat blocked polls (never
  re-stamped) so an operator can see how long a game has been stuck; cleared the moment a later
  snapshot reconciles cleanly.
- `playsBlockReason` — a capped application-level code (`COLLISION` | `UNMATCHED_EXISTING` |
  `COLLISION_AND_UNMATCHED` for a LIVE block; `FINAL_SNAPSHOT_INVALID` | `FINAL_REPLACEMENT_FAILED`
  for a FINAL replacement outcome, added in M27.2 — see
  [Final reconciliation](#final-reconciliation)), never free text — no provider terms or
  descriptions can leak through this field.
- `playsReviewRequired` — `true` while blocked, cleared automatically on either an unforced clean
  reconciliation/replacement or a successful operator repair.

Critically, a block **never fails the poll cycle** on its own — `overallOk`/`recordSuccess` are
computed exactly as before (a benign block, LIVE or FINAL, is not a `plays.ok = false` condition;
only a thrown exception is — for FINAL specifically, that means `FINAL_SNAPSHOT_INVALID` goes
through `recordSuccess` like any other block, while `FINAL_REPLACEMENT_FAILED` — an actual write
failure — goes through `recordFailure`'s retry path), so Game state and team-stat sync keep
completing every cycle regardless of a plays block. The block state is a passive, durable signal
for operators, not a scheduling gate — the poller never attempts an automatic repair for a LIVE
block; only a human-confirmed repair (see below) can resolve one. (A FINAL block is different: it
resolves itself automatically the moment a later provider snapshot passes validation, exactly like
FINAL replacement's normal fingerprint-based operation — no operator action is required unless the
snapshot keeps failing validation.)

Blocked FINAL games follow the same discovery window as any other FINAL game (24h /
`final60CompletedAt`, see [Discovery](#discovery)) — they are **not** rescanned indefinitely once
they drop out of that window. Operators find and resolve a stuck game via the admin plays-review
queue or the reconciliation CLI, not by the poller retrying forever.

See [play-reconciliation-review.md](play-reconciliation-review.md) for the full diagnostic/repair
workflow, the four possible outcomes, and the non-destructive repair mechanics.

## Operational commands

```bash
# Bounded single cycle, works even with CURRENT_GAME_POLLER_ENABLED=false
npm run current-games:poller -- --once --dry-run

# Bounded single cycle against exactly one reviewed game, for debugging (also ignores the switch)
npm run current-games:poller -- --once --gameId=<uuid>

# A real bounded run (requires CURRENT_GAME_POLLER_ENABLED=true unless scoped with --gameId/--dry-run)
npm run current-games:poller -- --once
npm run current-games:poller -- --durationMinutes=180

# Sanitized read-only recent-game match + box-score audit
npm run current-games:box-score-audit -- --hours=24 --limit=2

# Read-only reconciliation diagnostic (the default — no flag needed for safe inspection)
npm run current-games:plays:reconcile -- --gameId=<uuid>

# Explicit repair, one mode per invocation (requires --reason and --operatorEmail)
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=append-only \
  --reason="Provider only appended new plays" --operatorEmail=ops@example.com
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=structural-relink \
  --reason="Disambiguated by operator" --operatorEmail=ops@example.com \
  --relink=<existingPlayId>:<desiredSequence>,<existingPlayId>:<desiredSequence>
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=rebuild-after-cutoff \
  --reason="Clean cutoff after divergence" --operatorEmail=ops@example.com --cutoffSequence=82

# Manual FINAL replacement pass (normally automatic via the poller — see Final reconciliation)
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=final-replace \
  [--phase=final-immediate|final-10|final-60] [--operatorEmail=ops@example.com]
```

The long-running Render worker and bounded CLI share the same composition. Each cycle logs
provider request counts plus player-stat attempt/health/coverage/next-poll fields without provider
payloads or IDs. There is no separate scheduler, queue, or admin status endpoint.
