# M26.2: live-validation diagnostic harness

Milestone 26.2 adds a bounded, operator-run diagnostic harness for observing Highlightly's
live-game behavior — freshness, request cost, reconciliation stability — ahead of building an
always-on poller. It is **not** the production live-game system: see
[active-game-poller.md](active-game-poller.md) for that (M27), which is what should be used for
ordinary live-game operation going forward. This harness remains available for bounded, one-off
diagnostic checks (e.g. validating a new provider behavior against a single game) and is
unaffected by the poller's enable switch.

## What it is for

- Confirming a specific internal game's Highlightly mapping and orientation before kickoff.
- Measuring real request cost per tick, provider clock/score freshness, and team-stat
  availability across a game's lifecycle.
- Recording manual reference markers (e.g. "Eagles TD shown on TV") for rough latency comparison
  against Highlightly's first appearance of the same play. This is **observed provider latency**
  (when 2nd & 15 first saw the play), not true event latency — Highlightly does not supply a
  stadium-event timestamp, so exact snap-to-observation latency is never claimed.

## What it does not do

- No frontend changes, no production cron/scheduler, no queues, no WebSockets/SSE.
- No discovery across multiple games — a single `--gameId` is always explicit.
- No unbounded execution — it always runs either one tick (`--once`-equivalent default) or a
  bounded `--durationMinutes`.

## Commands

```bash
# One diagnostic tick, read-only
npm run current-games:live-validate -- --gameId=<uuid>

# Bounded run at the optimized 2-request/tick interval
npm run current-games:live-validate -- --gameId=<uuid> --intervalSeconds=120 --durationMinutes=180

# Append a manual reference marker to the same report (no provider request)
npm run current-games:live-validate -- --gameId=<uuid> --marker="Eagles touchdown shown on TV"

# Explicit opt-in live GamePlay persistence (diagnostic-only path; requires
# HIGHLIGHTLY_PUBLICATION_APPROVED=true regardless of evaluation mode)
npm run current-games:live-validate -- --gameId=<uuid> --applyPlays --durationMinutes=180
```

Default interval is 60 seconds (never faster). Output is an append-only JSONL file
(`var/live-validation/<gameId>.jsonl` by default, gitignored) — tick records, markers, and a
final run summary, safe to write to concurrently from a second terminal invoking `--marker`.

## Request efficiency

Each tick makes at most two Highlightly HTTP requests, using the same shared match-detail fetch
the M27 poller also uses (`src/modules/sports/highlightly-match-detail-fetcher.ts`): one
current-state/schedule lookup, and one match-detail lookup that feeds both the real team-stat
normalizer (`normalizeHighlightlyCurrentGameDetails`) and the real play normalizer
(`normalizeHighlightlyCurrentGamePlays`) — never fetched twice for the two surfaces.

## `--apply` and `--applyPlays`

Two independent, explicit opt-in flags, both requiring `HIGHLIGHTLY_PUBLICATION_APPROVED=true`
(a stricter requirement than the general Highlightly evaluation-mode gate used elsewhere):

- `--apply` writes Game state and `CurrentGameTeamStat` through the unmodified, real
  `CurrentGameSyncService`/`CurrentGameDetailsSyncService` — the same production-safe path used
  by the manual `games:current:sync`/`games:current:details:sync` commands, and (since it forces
  the full unmerged two-service call) reverts to 3 requests/tick.
- `--applyPlays` persists live `GamePlay` rows before FINAL by calling `identifyPlays`,
  `reconcilePlays`, and `CurrentGamePlayRepository.applySnapshot` directly — the same functions
  the M27 poller now uses in production. It never touches `CurrentGamePlaySyncService`'s
  FINAL-only gate; that gate stays exactly as it was for the manual command. A blocked
  reconciliation (collision or unmatched existing row) skips the write and is reported, never
  silently discarded.

This exact `--applyPlays` path was validated end-to-end against a live game (Philadelphia Eagles
@ New England Patriots, 2026 preseason week 2) before M27 existed, which is what established that
live GamePlay persistence was safe to promote into the production poller.
