# Live-game worker

`src/workers/current-game-worker.ts` is the long-running production process
that keeps current-game state (scores, team stats, plays, highlights) synced
from Highlightly by repeatedly running `CurrentGamePoller.runCycle`. This
document covers why it exists, how it differs from the bounded debugging CLI,
its startup/shutdown/failure behavior, multi-instance safety, and how an
operator verifies it's actually alive — including the live-game verification
that still needs to be run by a human.

## Why it exists

`src/commands/current-game-poller.ts` is a bounded CLI: it requires either
`--once` (run exactly one cycle and exit) or `--durationMinutes=<n>` (loop for
a bounded number of minutes, then exit). That's the right shape for local
debugging and one-off verification runs, but wrong for production, which
needs a process that keeps running indefinitely for the life of the
deployment. `current-game-worker.ts` is that process: no bounded duration, no
required flags, just an indefinite loop until it's told to stop.

`current-game-poller.ts` remains useful and is not being retired — keep using
it for:

- `--once` — run a single cycle and inspect the JSON report.
- `--dry-run` — preview what a cycle would do without writing.
- `--gameId=<uuid>` — debug polling for one specific game.

The worker has none of those flags; it always runs broad polling for as long
as it's alive.

## Startup refusal behavior

Like the CLI, the worker refuses to run broad polling when
`CURRENT_GAME_POLLER_ENABLED=false`. Unlike the CLI (which allows `--dry-run`
or `--gameId` even when the master switch is off), the worker has no such
escape hatch — it only ever does broad polling, so if the switch is off it
logs an error and exits with a non-zero code instead of starting the loop:

```
CURRENT_GAME_POLLER_ENABLED is false. Refusing to start the live-game worker --
set CURRENT_GAME_POLLER_ENABLED=true to run broad polling in production.
```

This means an operator can never accidentally end up with a worker process
running and silently doing nothing — it either polls or it doesn't start.

## Graceful shutdown (SIGTERM/SIGINT)

The worker installs handlers for both `SIGTERM` and `SIGINT`
(`createShutdownSignal`). On either signal it:

1. Logs the received signal.
2. Sets an internal "shutdown requested" flag.
3. Lets any in-flight cycle finish naturally (it does not abort mid-cycle).
4. Skips the next heartbeat sleep (the sleep is interruptible — see
   `interruptibleSleep` — so shutdown doesn't wait out a full heartbeat
   period).
5. Exits the loop, logs `current-game-worker shutting down`, and disconnects
   Prisma in a `finally` block.

This is the standard shape container orchestrators expect: send `SIGTERM`,
give the process a grace period to finish its current unit of work, then it
exits on its own.

## Failure resilience

The worker never crashes the process on a single failed cycle. Each call to
`poller.runCycle()` is wrapped in its own `try/catch` inside the loop:

```ts
try {
  const report = await poller.runCycle(cycleOptions);
  logger.info(summarizeCycle(report), 'current-game-worker cycle completed');
} catch (error: unknown) {
  logger.error(
    { message: error instanceof Error ? error.message : 'Unknown error' },
    'current-game-worker cycle failed; will retry after the normal heartbeat delay',
  );
}
```

A failed cycle is logged and the loop simply continues to its normal
heartbeat sleep (`CURRENT_GAME_POLLER_HEARTBEAT_SECONDS`, interruptible by
shutdown) before retrying. There is no tight retry loop and no crash-and-let
the-orchestrator-restart behavior for a transient failure — the worker is
designed to ride out one bad cycle (a Highlightly timeout, a transient DB
hiccup, etc.) and simply try again on the next heartbeat.

## Multi-instance safety during deploys

The worker adds **no new locking**. It reuses the existing DB claim/lease
locking already built into the current-game poller and
`CurrentGamePollState`:

- `CurrentGamePollState.lockedAt` / `CurrentGamePollState.lockedBy` implement
  a short transactional claim per game row.
- `CURRENT_GAME_POLLER_LOCK_LEASE_SECONDS` (`config.currentGame.poller.lockLeaseSeconds`)
  bounds how long a claim is held before it's considered stale and can be
  reclaimed by another instance.

This is what makes it safe for an old worker instance and a newly deployed
one to briefly overlap during a rolling deploy: both processes can call
`runCycle()` concurrently, but the lease locking ensures only one of them is
actively working a given game at a time. No Redis, no distributed lock
service, no new coordination mechanism was introduced — the pre-existing DB
lease is the entire mechanism, for both the CLI and the worker.

## Verifying liveness operationally ("Option A": DB heartbeat, no new table)

No new heartbeat table was built for this worker. Instead, verify liveness
by reading the existing `CurrentGamePollState` rows the worker (or CLI)
writes to on every cycle:

- `lastAttemptAt` — updated every time a game is polled, whether or not the
  poll succeeded. If this timestamp is recent (within roughly one heartbeat
  interval plus the game's own poll interval) for games that should be
  actively polling, the worker is running cycles.
- `lastSuccessAt` — updated only on a successful poll; compare against
  `lastAttemptAt` to distinguish "the worker is running but failing" from
  "the worker is running and succeeding."
- `lockedBy` / `lockedAt` — shows which process instance currently holds the
  claim on a game row, useful for confirming which of possibly-multiple
  running instances is doing the work.

An operator can check this with `prisma studio` (`npm run prisma:studio`),
which is the simplest zero-code way to browse `CurrentGamePollState` rows
directly. Alternatively, a one-off script or `psql` query works, e.g.:

```sql
SELECT game_id, scheduling_class, last_attempt_at, last_success_at,
       locked_by, locked_at, last_error
FROM current_game_poll_states
ORDER BY last_attempt_at DESC NULLS LAST
LIMIT 20;
```

or the Prisma equivalent from a Node REPL/script:

```ts
await prisma.currentGamePollState.findMany({
  orderBy: { lastAttemptAt: 'desc' },
  take: 20,
});
```

If `lastAttemptAt` values stop advancing across multiple checks a few
heartbeat intervals apart, the worker process is not running cycles (crashed,
never started, or `CURRENT_GAME_POLLER_ENABLED` is false) and needs
operator attention.

## Verifying against a real game (must be run live by a human)

The worker's behavior against real, in-progress Highlightly data has **not**
been validated end-to-end as part of this change and must not be claimed as
validated until a human operator actually runs it during a real NFL game
window. This is not something that can be verified ahead of time from a
desk — it requires live provider data. Follow these steps yourself during an
upcoming game:

1. **Before kickoff**, confirm the environment the worker will run against
   has:
   - `CURRENT_GAME_POLLER_ENABLED=true`
   - Valid `HIGHLIGHTLY_API_KEY` and the rest of the `HIGHLIGHTLY_*` block
   - `HIGHLIGHTLY_EVALUATION_MODE` / `HIGHLIGHTLY_PUBLICATION_APPROVED` set
     to the values appropriate for the environment being tested (evaluation
     mode is safer for a first real-game dry run)
   - A reachable `DATABASE_URL` with the game already present as an internal
     game row (created via the normal schedule import) so the poller has
     something to discover.
2. **Start the worker** in that environment:
   ```sh
   npm run current-games:worker:dev   # local/staging, via tsx
   # or, against a built deployment:
   npm run current-games:worker
   ```
3. **Watch the structured log output.** Every cycle logs a
   `current-game-worker cycle completed` line (or `cycle failed` on error)
   with `candidatesDiscovered`, `claimed`, `degraded`, and
   `providerRequests`. Confirm the target game is being discovered and
   claimed once pregame polling should start.
4. **Cross-check against `CurrentGamePollState`** using the query above —
   confirm `lastAttemptAt`/`lastSuccessAt` are advancing at roughly the
   expected cadence for the game's current scheduling class
   (`CURRENT_GAME_PREGAME_POLL_SECONDS`, `CURRENT_GAME_LIVE_POLL_SECONDS`,
   `CURRENT_GAME_FEATURED_POLL_SECONDS`, `CURRENT_GAME_HALFTIME_POLL_SECONDS`),
   and that `lastError` stays `null` (or, if it isn't, that the worker logs
   show it recovering on the next cycle rather than getting stuck).
5. **Watch through at least one status transition** (pregame → live, and
   ideally live → final) to confirm the scheduling class updates and polling
   cadence changes accordingly, and that the process survives the whole
   window without needing a manual restart.
6. **Test graceful shutdown** once during the run: send the process a
   `SIGTERM` (or Ctrl+C for `SIGINT` locally) and confirm the in-flight cycle
   finishes, the shutdown log line appears, and the process exits cleanly
   rather than hanging or crashing.
7. **Record the outcome** (which game, which environment, what was observed,
   any anomalies) somewhere durable so this validation step has a paper
   trail — this document intentionally does not claim that step has already
   happened.

Do not treat the worker as production-validated against real live-game data
until this has actually been carried out.
