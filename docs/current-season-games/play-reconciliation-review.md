# Play reconciliation review, repair, and FINAL replacement

Milestone 27 (the active-game poller) can persist live `GamePlay` rows before a game reaches
`FINAL`. When the provider's post-game snapshot diverges from what was polled live — a
renumbering, a corrected description, or a genuinely shrunk/reordered set of plays — the shared
`identifyPlays`/`reconcilePlays` core (see [play-by-play.md](play-by-play.md#identity-and-reconciliation))
correctly **blocks the entire write** rather than guess. That is desired behavior: no stored play
history is ever silently dropped.

Two milestones build on that foundation, and this doc covers both:

- **M27.1** (below): operator review and repair tooling for a blocked _LIVE_ reconciliation — a
  bounded read-only diagnostic, three conservative repair modes, durable poll-state visibility,
  and an admin API/CLI. Repair is never automatic; the poller never attempts one.
- **M27.2** ([jump to section](#final-authoritative-snapshot-replacement-m272)): once a game
  reaches FINAL, the provider's snapshot is treated as authoritative and _replaces_ the active
  play set outright rather than being reconciled against it. This is the production answer to the
  PHI @ NE case below, where a full-game renumbering left M27.1's repair modes with nothing safe
  to do.

Nothing in M27.1 changes how blocking is detected, and M27.2 doesn't change LIVE behavior at all —
before FINAL, ingestion is still exactly `identifyPlays`/`reconcilePlays`/`applySnapshot`, blocking
exactly as documented below.

## Why live and FINAL snapshots diverge

A live snapshot only contains plays observed so far, in whatever order the provider streamed
them. The FINAL snapshot is often a full re-derivation of the entire game — different play counts
(more detail, corrected omissions), different sequence numbers (positions across the full game
rather than the partial live feed), and occasionally corrected descriptions or reclassified play
types. `reconcilePlays` handles the common, safe cases automatically (a corrected description
still matches via the structural key; new plays simply insert); it blocks only when it cannot
safely resolve every stored row.

## Diagnosing a block

```bash
npm run current-games:plays:reconcile -- --gameId=<uuid>
```

This is **read-only by default** — no flag is required for safe inspection, and no write ever
happens without an explicit `--apply`. It fetches the current provider snapshot, runs the same
`identifyPlays`/`reconcilePlays` core the poller uses, and returns a bounded
`ReconciliationDiagnostic` (`src/modules/sports/current-game-play-reconciliation-diagnostic.ts`):
stored/provider counts, exact vs. structural match counts, collision and reordering counts, the
first diverging sequence, up to 20 divergence windows (grouped by period and contiguous sequence
range — never a raw per-play dump even at 184 plays), and a `safeRepairCandidate` classification
with a plain-language `safeRepairReason`.

`safeRepairCandidate` is one of:

- **`APPEND_ONLY`** — the snapshot isn't actually blocked; every stored play still matches and the
  provider only added a later tail. This is just an ordinary unblocked reconcile.
- **`STRUCTURAL_RELINK`** — every unmatched stored row is accounted for by a bounded structural
  collision (an existing stored row sharing a structural key with more than one candidate — see
  below). Resolvable by operator-supplied manual links.
- **`REBUILD_AFTER_CUTOFF`** — every stored play up to some sequence `N` matches the new snapshot
  _exactly_, with **zero reordering and zero collisions anywhere in the whole game**, and every
  stored play after `N` is unmatched. Resolvable by superseding the trailing block and rebuilding
  it from the new snapshot.
- **`NO_SAFE_REPAIR`** — none of the above conditions hold. Divergence is scattered, mixed with
  collisions, or the matched head has been reordered. Leave the game blocked; there is no
  automatic or manual path in this milestone that can resolve it without risking data loss.

The admin diagnostic endpoint additionally returns `collisionGroups`, with each candidate's
sequence and a truncated description — the one place a provider description appears on an admin
surface, because disambiguating a collision is impossible without it. This is capability-gated
and never reaches the public API.

## Why REBUILD_AFTER_CUTOFF requires zero reordering, not just zero collisions

A play matching by content (`exactMatches`) is not the same as it being _safe to keep in place_.
If the provider's FINAL snapshot renumbers the whole game — the common case, since a live feed
only contains what's aired so far while FINAL often re-derives the complete play list — a play
that's unquestionably "the same play" by content can still land at a different sequence number.
`REBUILD_AFTER_CUTOFF` requires the retained head to be **sequence-stable**, not just
content-matched, because superseding only the tail is only safe if the head's positions are
untouched. When the whole game has been renumbered, there is no trustworthy "head" to preserve in
place — this correctly falls through to `NO_SAFE_REPAIR` (see the PHI @ NE case below). There is
no force/override to push a rebuild through when this invariant doesn't hold.

## Repair modes

All three modes share one execution path
(`src/modules/sports/current-game-play-repair.ts`, `PlayReconciliationRepairService.repair`):
it **always refetches the provider snapshot fresh** at execution time — never trusting a
caller-supplied diagnostic that might be stale — and fails closed if the safety invariant no
longer holds.

### APPEND_ONLY

```bash
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=append-only \
  --reason="..." --operatorEmail=<email>
```

Applies only when a plain reconcile is not blocked. This is the same write path
(`CurrentGamePlayRepository.applySnapshot`) the poller and the FINAL-only sync command already
use — no distinct code path, just a real audited actor in place of the hardcoded CLI string.

### STRUCTURAL_RELINK

```bash
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=structural-relink \
  --reason="..." --operatorEmail=<email> \
  --relink=<existingPlayId>:<desiredSequence>,<existingPlayId>:<desiredSequence>
```

`reconcilePlays` already resolves a corrected description automatically via the structural key —
this mode exists only for the case it deliberately refuses: more than one unused stored row
sharing a structural key for one desired play. `manualLinks` are seeded before the automatic pass
runs, so an operator's explicit pairing (`existingPlayId` → `desiredSequence`, using context like
description similarity the algorithm intentionally ignores) always wins. An invalid or incomplete
set of links is silently ignored by the matching core and simply falls through to normal
collision detection — the repair call re-checks after applying links and rejects (409
`REPAIR_LINKS_INCOMPLETE`) if the snapshot is still blocked, so an incomplete link set never
partially applies.

### REBUILD_AFTER_CUTOFF

```bash
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=rebuild-after-cutoff \
  --reason="..." --operatorEmail=<email> --cutoffSequence=<n>
```

Requires an explicit `cutoffSequence`. Before writing anything, it re-validates against a fresh
plan that every active stored play at or before the cutoff is deterministically matched at that
exact sequence, with zero collisions anywhere and zero reordering at or before the cutoff — if
that doesn't hold, it rejects (409 `REPAIR_CUTOFF_INVALID`) and writes nothing. Only then does it:

1. Mark every stored row after the cutoff **superseded** (`supersededAt`, `supersededByRunId`) —
   never deleted.
2. Insert the provider's plays after the cutoff as fresh rows (never reusing an old, now-untrusted
   id for the rebuilt tail).
3. Write one `AdminAuditEvent` (`CURRENT_GAME_PLAYS_REPAIR_REBUILT`) capturing actor, prior/new
   counts, superseded count, cutoff, and the operator's reason.

### NO_SAFE_REPAIR

No mode applies. The CLI's default (diagnostic) output already explains why; the game stays
blocked until either a later provider snapshot resolves it on its own, or (for the common
full-game-renumbering shape — see the PHI @ NE case below) FINAL replacement supersedes the
question entirely once the game reaches FINAL — see
[FINAL: authoritative snapshot replacement](#final-authoritative-snapshot-replacement-m272).

## Non-destructive supersede mechanism

`GamePlay` gained two nullable columns: `supersededAt` and `supersededByRunId`. A superseded row
is **never deleted** — it is excluded from every reconciliation read (`findTarget`) and from the
public API (`findPlays`) via a plain `supersededAt: null` filter, but it still exists in the
database for audit/history.

The two identity constraints that used to be plain unique constraints —
`(gameId, playKey)` and `(gameId, sequence)` — are now **partial unique indexes** scoped to
`WHERE superseded_at IS NULL`, hand-authored in the migration SQL (Prisma's schema DSL cannot
express a partial predicate, so `schema.prisma` shows them only as plain `@@index`). This is what
lets an active row and its superseded predecessor share the same `playKey`/`sequence` without a
constraint violation — the entire mechanism a rebuild depends on.

**This partial-index/full-constraint distinction must be preserved.** Do not convert
`game_plays_active_game_play_key` / `game_plays_active_game_sequence_key` back into Prisma
`@@unique([gameId, playKey])` / `@@unique([gameId, sequence])` — doing so would reject every
legitimate rebuild write. Because `prisma migrate diff`/`prisma migrate status` cannot see a
partial index at all, this gap between what the schema file says and what the database enforces
is permanent and must be checked by hand after any future migration touching this table:

1. `npx prisma migrate status` — confirms the migration applied with no reported drift.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` —
   confirms Prisma does **not** propose adding either `@@unique` back, and does not propose
   dropping the partial indexes it doesn't manage.
3. `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'game_plays';` — confirms both
   `game_plays_active_game_play_key` / `game_plays_active_game_sequence_key` exist with
   `WHERE superseded_at IS NULL` in their definition.
4. Functional check: insert a superseded row and an active row sharing a `(gameId, sequence)` —
   must succeed. Insert a second **active** row duplicating an existing active row's
   `(gameId, sequence)` — must be rejected.

All four steps were run against the live database when this migration was deployed (2026-08-23);
steps 1–3 passed with the expected zero-drift result, and step 4 confirmed both invariants using a
throwaway synthetic game (created and deleted within the same check, never touching real data).

## Poller behavior while blocked

A block is a durable fact (`CurrentGamePollState.playsBlockedAt`/`playsBlockReason`/
`playsReviewRequired`), not a scheduling gate — see
[Plays blocked state](active-game-poller.md#plays-blocked-state-m271) in the poller doc for the
full detail. It never fails a poll cycle, is preserved (not re-stamped) across repeat blocked
polls, and clears automatically the moment a later snapshot reconciles cleanly — with no repair
action involved.

## Operator workflow

1. `GET /api/v1/admin/games/plays-review-queue` (or the poller's stdout `playsBlocked` field) to
   find a stuck game.
2. `GET /api/v1/admin/games/:gameId/plays/diagnostic` (or the CLI default) to see why.
3. If `safeRepairCandidate` is not `NO_SAFE_REPAIR`, `POST /api/v1/admin/games/:gameId/plays/repair`
   (or the CLI `--apply`) with the matching `mode`, a `reason`, and any mode-specific fields.
4. Verify: stored count, public endpoint output, sequence continuity, stable ids on matched plays,
   no duplicates, no provider-term leakage.

## Capabilities and audit

`VIEW_GAME_PLAYS_DIAGNOSTIC` (EDITOR and ADMIN) gates the diagnostic and review-queue endpoints.
`REPAIR_GAME_PLAYS` (ADMIN only — the same risk tier as `REMOVE_OVERRIDE`) gates the repair
endpoint. Every mutation — HTTP or CLI — writes an `AdminAuditEvent` with a real actor (the
authenticated principal over HTTP; an explicit `--operatorEmail` over the CLI, not cross-checked
against a real user record, matching every other CLI actor convention in this repo), the mode,
prior/new counts, cutoff (if used), and the operator's reason.

## What is never exposed publicly

`GET /api/v1/games/:gameId/plays` changed by exactly one thing: superseded rows are excluded from
its query. `playsReviewRequired`, block reasons, collision counts, provider terms, and any
"still being reconciled" wording are strictly admin/operator-only — the public route and its DTO
carry none of them, in any form. Stable play ids are preserved automatically by the reconciliation
design (a matched row keeps its id; only genuinely new or rebuilt-tail plays get new ids), so no
frontend change is required — a resolved block simply means more/finalized plays on next refetch.

## FINAL: authoritative snapshot replacement (M27.2)

Running M27.1's diagnostic against the real PHI @ NE game (below) revealed the actual shape of
the LIVE → FINAL divergence problem: Highlightly's FINAL snapshot doesn't just append or correct
plays, it renumbers the _entire_ game. 82 of PHI @ NE's 87 stored plays still matched by content,
but at different sequence positions — and none of M27.1's three repair modes can safely resolve a
full-game renumbering, by design (no mode does resequencing).

The product decision behind M27.2: 2nd & 15 has no feature today that depends on a `GamePlay.id`
staying stable across the LIVE → FINAL transition (no play-level comments, bookmarks, per-play
URLs, or fantasy scoring keyed to it). Given that, once a game reaches FINAL and a validated,
complete provider snapshot is available, that snapshot is treated as **authoritative** — the
active LIVE rows are superseded (never deleted) and the FINAL snapshot is installed as the new
active set outright, with no attempt at row-level reconciliation or resequencing.

**LIVE behavior is completely unchanged.** Everything above this section — blocking,
`identifyPlays`/`reconcilePlays`/`applySnapshot`, the three M27.1 repair modes — still applies
exactly as documented for any game that hasn't reached FINAL. M27.1's repair modes remain
available after FINAL too, for the cases FINAL replacement itself refuses (see validation below).

### Validation and the plausibility guard

`FinalPlaySnapshotService.replace()` (`src/modules/sports/current-game-play-final-replacement.ts`)
validates before writing anything:

- the internal game exists, is `FINAL`, and has a verified provider mapping (same guards used
  everywhere else in this module).
- the provider snapshot's game identity (teams, orientation) matches the verified internal game.
- normalization succeeds, sequence values are contiguous `1..N` with no gaps, and there are no
  duplicate play keys — `identifyPlays` guarantees all three by construction, but they're checked
  defensively rather than assumed.
- **plausibility guard**: if any plays are currently active, the FINAL snapshot must not be
  smaller (`finalCount >= existingActiveCount`) — a plain threshold, not an invented percentage.
  PHI @ NE's 87 → 184 clearly passes; a snapshot that's unexpectedly _smaller_ than the live set
  fails closed and leaves the active plays untouched.
- an empty FINAL snapshot is only accepted when nothing is currently active either (a genuinely
  no-play-by-play game that was never live-tracked) — otherwise it's rejected as data loss.

Any failure returns a `VALIDATION_FAILED` result — nothing is written, the active plays are
untouched, and the poller records `playsBlockReason: 'FINAL_SNAPSHOT_INVALID'`,
`playsReviewRequired: true` (via the same durable block-state mechanism as M27.1 — this is a
benign block, not a failed cycle: Game state and team stats keep syncing normally). A thrown
exception from the write itself (as opposed to a validation rejection) is a genuine failure and
records `playsBlockReason: 'FINAL_REPLACEMENT_FAILED'` through the retry path instead.

### Idempotency: fingerprinting, not a stored flag

Every replacement pass (`FINAL_IMMEDIATE`, `+10`, `+60`) runs the same validation and a
content fingerprint comparison before writing anything. The fingerprint
(`computeFinalSnapshotFingerprint`) hashes an ordered projection of each play's content —
sequence, period, clock, type, description, possession, down/distance, field position, and
scoring/penalty/turnover flags — deliberately excluding database ids, provider ids, and any
timestamp that changes per request without the play content changing. Because the currently-active
stored rows and a freshly-normalized provider snapshot share every one of those fields, the same
function fingerprints both — no new column or stored value was needed. If the two fingerprints
match, the pass is a `NOOP_UNCHANGED`: nothing is superseded, nothing is inserted. This is what
makes a `+10`/`+60` correction pass a true no-op when the provider hasn't changed anything, and a
real replacement (superseding the previous FINAL rows, not the original LIVE rows a second time)
when a postgame correction actually changes something.

### Mechanics

One transaction (`replaceWithAuthoritativeFinalSnapshot`,
`src/modules/sports/current-game-play.repository.ts`): every currently-active row for the game is
marked superseded (`supersededAt`, `supersededByRunId`) — **never deleted** — then the normalized
FINAL snapshot is inserted as fresh rows. If anything in the transaction throws, Prisma rolls the
whole thing back and the previous active rows remain active, untouched. One `AdminAuditEvent`
(`CURRENT_GAME_PLAYS_FINAL_REPLACED`) captures the phase, fingerprint, and prior/new/superseded
counts. This is a system/poller-triggered action (or a manually-triggered CLI run), so — like the
existing `current-game-plays-sync-cli` precedent — there's no human `AuditActor`/principal to
attach; the actor is a fixed label (`'current-game-poller'` from the poller, or
`--operatorEmail`/`'current-game-plays-reconcile-cli'` from the manual CLI path).

### FINAL play ids are new — this is intentional

**No attempt is made to preserve LIVE `GamePlay` ids across a FINAL replacement.** Every FINAL row
is a fresh insert. This is a deliberate product decision, not an oversight: nothing in the product
today depends on a play id staying stable across the LIVE → FINAL transition. The frontend should
treat `GamePlay.id` as stable only for the lifetime of the currently-active snapshot — a resolved
FINAL replacement just means the public endpoint returns a fresh, complete, correctly-ordered play
list on next refetch, with new ids.

### Poller integration and the three passes

`CurrentGamePoller` branches on `observedGame.status`: LIVE/HALFTIME use the unchanged
reconciliation path; FINAL routes to `FinalPlaySnapshotService.replace()` using the **same**
already-fetched/normalized provider snapshot the tick computed for team stats — no extra provider
request, preserving the documented one-request-per-tick budget. The phase
(`FINAL_IMMEDIATE`/`FINAL_10`/`FINAL_60`) is derived from the same poll-state transition logic
that already scheduled the +10/+60 reconciliation passes (see
[Final reconciliation](active-game-poller.md#final-reconciliation)); each pass gets a real
provider re-fetch, so a postgame correction the provider makes between passes is caught and
applied — or found unchanged and skipped — automatically.

### CLI

```bash
npm run current-games:plays:reconcile -- --gameId=<uuid> --apply --mode=final-replace \
  [--phase=final-immediate|final-10|final-60]   # default: final-immediate
  [--operatorEmail=<email>]                      # optional for this mode only
```

Fetches the provider snapshot itself (unlike the poller path) and runs the identical
validate/fingerprint/replace logic — useful for a manual +10/+60-style correction check outside
the poller loop, and for the one-off PHI @ NE application below.

## Worked example: PHI @ NE

Internal game `b9d10d67-ee33-443f-bb2b-2e6e649f153c` was polled live and accumulated 87 stored
`GamePlay` rows. After the game reached FINAL, Highlightly's snapshot grew to 184 plays. Running
the diagnostic against the real game:

```json
{
  "storedCount": 87,
  "providerCount": 184,
  "exactMatches": 82,
  "unmatchedStoredCount": 5,
  "collisions": 0,
  "reordered": 82,
  "firstDivergenceSequence": 83,
  "divergenceWindows": [
    { "period": 2, "fromSequence": 83, "toSequence": 87, "unmatchedStoredCount": 5 }
  ],
  "safeRepairCandidate": "NO_SAFE_REPAIR",
  "safeRepairReason": "Divergence is not confined to a bounded set of structural collisions or a contiguous trailing block, so no repair mode can be applied without risking data loss."
}
```

82 of the 87 stored plays genuinely still exist in the FINAL snapshot by content (`exactMatches:
82`) — but the FINAL snapshot renumbers the entire game (87 live-tracked plays became part of a
184-play full derivation), so all 82 matched plays now sit at different sequence positions
(`reordered: 82`). `REBUILD_AFTER_CUTOFF`'s zero-reordering gate for the retained head correctly
refuses this: there is no stable, untouched head to preserve in place, so rebuilding "after
sequence 82" would still be rewriting the position of every retained play, which this mode is
explicitly designed never to do silently. The 5 trailing stored rows being cleanly unmatched
(`unmatchedStoredCount: 5`, one contiguous window) is not, by itself, enough — the gate requires
_both_ a clean trailing divergence _and_ a sequence-stable head.

**M27.1 result: the game was correctly left blocked.** No repair mode in that milestone could
safely resolve a full-game renumbering — that would have required a distinct "resequence, don't
rebuild" mode recognizing stable content-identity across a position shift, deliberately out of
scope for M27.1. No mutation was applied at that point; the 87 stored rows remained exactly as
they were, and `playsReviewRequired` stayed `true` for operator visibility.

### M27.2 resolution

This is exactly the shape M27.2's FINAL replacement was built for. Running the same command with
`--apply --mode=final-replace --phase=final-immediate` against the real game:

```json
{
  "status": "REPLACED",
  "phase": "FINAL_IMMEDIATE",
  "priorActiveCount": 87,
  "newActiveCount": 184,
  "supersededCount": 87,
  "fingerprint": "43e2768430ae8d8ae019914cf06cf4bb563d899935da2a7d91669149c1a41ff1",
  "auditEventId": "576e3267-fe74-42a7-81d2-fd8d379752cf"
}
```

The plausibility guard passed cleanly (184 ≥ 87), so the 87 live rows were superseded (never
deleted) and the full 184-play FINAL snapshot was installed as the new active set. Verified
directly against the database and the public endpoint after applying:

- 184 active rows, sequences exactly `1..184` with no gaps or duplicates, no duplicate play keys.
- All 87 original rows still exist, each `supersededAt`-stamped and tagged with the same
  `supersededByRunId` — nothing was deleted.
- `GET /api/v1/games/b9d10d67-ee33-443f-bb2b-2e6e649f153c/plays` returns exactly 184 plays,
  oldest-to-newest by the new sequence, zero limitations, and zero provider/reconciliation
  leakage (no `highlightly`, `playKey`, `supersededAt`, or `playsReviewRequired` anywhere in the
  response).
- `playsBlockedAt`/`playsBlockReason`/`playsReviewRequired` all cleared on the poll-state row.
- One `AdminAuditEvent` (`CURRENT_GAME_PLAYS_FINAL_REPLACED`) recorded the actor, phase,
  fingerprint, and prior/new/superseded counts.

The 184 active rows carry new ids — none of the original 87 ids were reused, exactly as designed
(see [FINAL play ids are new](#final-play-ids-are-new--this-is-intentional)).
