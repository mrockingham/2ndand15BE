# Highlightly game highlights — evaluation and provider-neutral foundation (Milestone 31 / 31A / 31C)

This milestone determined exactly what NFL highlight/video data Highlightly's Pro
plan exposes, whether it maps deterministically to internal `Game` records, and
built the smallest provider-neutral backend foundation the real data justified.
No frontend playback, no betting/odds work, and no media downloading/rehosting/
proxying were done, per the milestone's scope. Every finding below is from real,
bounded, live API calls made through the existing `HighlightlyEvaluationHttpClient`
— nothing here was inferred from documentation alone.

**Milestone 31A** (below, §6A onward where marked) integrated this foundation
into the existing FINAL-reconciliation poller lifecycle, so completed games
receive highlight metadata automatically without manual CLI intervention —
still evaluation-driven, still no frontend work, still no inline embedding.

**Milestone 31C** (§13) resolves the embed-rights question left open by M31/
M31A: the backend now evaluates and persists a provider-neutral embed
eligibility decision (`embedStatus`/`canEmbed`) per highlight, using
Highlightly's `/highlights/geo-restrictions/{id}` endpoint. **Real-world
follow-up the same day**: both real highlights checked (PHI @ NE, SEA @ TEN)
came back `embedStatus: ALLOWED` yet failed to actually play in a YouTube
iframe — a per-video/domain YouTube embedding permission entirely invisible
to Highlightly's API. The public API now gates `canEmbed` behind an
additional global kill-switch, `HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED`, defaulted
to `false` until real playback is confirmed for a meaningful sample. No
frontend work exists in this repository; the frontend project referenced in
that milestone's Part B is separate. No downloading, rehosting, or proxying
was introduced — only an additional read-only provider lookup and a stored
decision.

## 1. Endpoint behavior (confirmed live, 2026-08-25)

Highlightly's own published documentation (`highlightly.net/nfl-api/documentation`)
describes `/highlights`, `/highlights/{id}`, and `/highlights/geo-restrictions/{id}`.
All three were called for real against this project's live API key and confirmed
to match the documentation:

- **`GET /highlights`** — a dedicated endpoint, **never embedded in
  `/matches/{id}`** (confirmed by inspecting the real detailed-match schema this
  app already parses — `HighlightlyDetailedMatch` has no `highlights`/`videos`/
  `media` field of any kind). Accepts `matchId`, `leagueName`, `season`, `date`,
  team filters, and `limit`/`offset` pagination. Response envelope:
  `{ data: [...], pagination: { totalCount, offset, limit }, plan: { tier, message } }`
  — the same envelope shape `/standings` already uses.
- **`GET /highlights/{id}`** — same item shape as one `data[]` entry from the
  list endpoint, wrapped in a one-element array.
- **`GET /highlights/geo-restrictions/{id}`** — `{ state, embeddable,
allowedCountries, blockedCountries }`. The one highlight checked returned `{
state: "No restricitons applied" (sic, provider's own typo), embeddable: true,
allowedCountries: [], blockedCountries: [] }`.

**NFL support**: confirmed — every query below returned real, correctly
NFL-scoped data (`league: "NFL"`, real team names/logos/abbreviations matching
this app's own `Team` catalog).

**Absence semantics**: a deliberately invalid `matchId` (`1`) returned **HTTP 200
with `data: []` and `pagination.totalCount: 0`** — a clean empty success, never an
error. This is the exact signal needed to distinguish "the provider was asked and
had nothing" from "the provider request failed," and it is what
`GameHighlightCoverage.UNAVAILABLE` vs `PROVIDER_ERROR` is built on.

## 2. Real NFL sample

Because the current date falls in the 2026 preseason, every game with a
Highlightly provider mapping in this project's database right now is a
preseason game (30 total; 29 `FINAL`, 1 `IN_PROGRESS` at evaluation time — no
`REG`/`POST` games exist yet to sample). Five were evaluated in depth, chosen
for status diversity:

| Game                      | Status      | Mapped? | Highlightly reachable? | Highlights | Thumbnail? | Canonical? | Embed? | Direct media? | Duration? | Requests | Coverage  |
| ------------------------- | ----------- | ------- | ---------------------- | ---------- | ---------- | ---------- | ------ | ------------- | --------- | -------- | --------- |
| PHI @ NE (Preseason Wk2)  | FINAL       | yes     | yes                    | 1          | yes        | yes        | yes    | no            | no        | 1        | AVAILABLE |
| KC @ TB (Preseason Wk2)   | FINAL       | yes     | yes                    | 1          | yes        | yes        | yes    | no            | no        | 1        | AVAILABLE |
| DAL @ ARI (Preseason Wk2) | FINAL       | yes     | yes                    | 1          | yes        | yes        | yes    | no            | no        | 1        | AVAILABLE |
| CHI @ CIN (Preseason Wk2) | FINAL       | yes     | yes                    | 1          | yes        | yes        | yes    | no            | no        | 1        | AVAILABLE |
| SEA @ TEN (Preseason Wk2) | IN_PROGRESS | yes     | yes                    | 1          | yes        | yes        | yes    | no            | no        | 1        | AVAILABLE |

All five, including the one still `IN_PROGRESS` at check time, already had
exactly one highlight — the game's own full broadcast-length recap, not a short
clip. (This game had almost certainly already finished playing in real time by
the moment it was checked; this is not evidence that highlights appear mid-game,
only that they can appear before this application's own status reconciliation
has caught up to `FINAL`. See §6.)

A broader, unfiltered NFL query (`limit=20`, no `matchId` filter) confirmed the
pattern holds at scale: **20 of 20** returned items were `category: "other"`,
spanning **20 distinct games** (never more than one highlight per game in this
sample), out of a reported `pagination.totalCount: 3650` highlights in
Highlightly's all-time NFL index.

### Exact field shape (sanitized; real values from the PHI @ NE highlight)

```json
{
  "id": 105170,
  "match": { "id": 566033, "league": "NFL", "season": 2026, "round": "preseason" },
  "type": "VERIFIED",
  "imgUrl": "https://i.ytimg.com/vi/oaMBTMAdkW8/hqdefault.jpg",
  "title": "Philadelphia Eagles vs. New England Patriots | 2026 Preseason Week 2",
  "description": null,
  "url": "https://www.youtube.com/watch?v=oaMBTMAdkW8",
  "embedUrl": "https://www.youtube.com/embed/oaMBTMAdkW8",
  "channel": "NFL",
  "source": "youtube",
  "category": "other"
}
```

`description` was `null` on all five sampled highlights — a real, documented
field that simply wasn't populated for any full-game recap in this sample.
`channel: "NFL"` / `source: "youtube"` on every item confirms the underlying
video is the league's own official YouTube upload, not a Highlightly-hosted
asset — Highlightly is an index/pointer layer here, not a video host.

**Fields Highlightly never supplies, confirmed absent from every sample and from
the published documentation**: a direct video file URL, an HLS manifest URL, a
duration, and a play/event/quarter/clock identifier tying the highlight to a
specific moment in the game. `directMediaUrl` and a duration field were
therefore **not** added to the persisted model or the provider-neutral contract
— see §8.

## 3. Media type classification

| URL field  | Real example                                       | Classification                                                           |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `url`      | `https://www.youtube.com/watch?v=oaMBTMAdkW8`      | `CANONICAL_PAGE`                                                         |
| `embedUrl` | `https://www.youtube.com/embed/oaMBTMAdkW8`        | `EMBED` (YouTube iframe-embeddable URL — an embed _pointer_, not a file) |
| `imgUrl`   | `https://i.ytimg.com/vi/oaMBTMAdkW8/hqdefault.jpg` | `THUMBNAIL`                                                              |

No `DIRECT_VIDEO` or `HLS` URL was ever observed or is documented for this
endpoint. Classification was based on the endpoint's own documented semantics
(a `url` vs. an `embedUrl` field, not a filename/extension guess), per the
milestone's instruction not to infer media type from a file extension alone.

## 4. Request economics

- **`/highlights` is a genuinely separate request from `/matches/{id}`** — the
  existing match-detail fetch does not include highlight data, so highlight sync
  always costs **exactly 1 additional request per game per sync** (bounded,
  `limit=40` in the actual fetcher), never 0 and never more than 1 in normal
  operation (a single `matchId`-filtered call always returns that game's full
  highlight set — up to `pagination.totalCount` for that game, which was 1 in
  every sample).
- **Latency**: 148–395 ms per call across all 8 calls made during discovery.
- **Quota usage**: the evaluation's 10 total requests (8 in the first probe, 2 in
  the follow-up) moved the observed `x-ratelimit-requests-remaining` header from
  7500 to 7490 — negligible against the Pro plan's budget. `GameHighlightsService`
  reuses the exact same `HighlightlyEvaluationHttpClient` instance (and therefore
  the same shared request-count/rate-limit tracking) as the Data Health probe and
  the live-game sync path — no second HTTP stack, no separately-tracked quota.

## 5. Rights / delivery model

The existing Highlightly terms review (`docs/highlightly-evaluation.md`,
`docs/current-season-games/sync-hardening.md`) already flags **"video-highlight
embedding, source-specific rights, and attribution"** as a question requiring
written confirmation before use — this milestone does not resolve that question,
and does not claim to. Classification, using this repo's existing conservative
posture:

- **Storing highlight metadata (title/description/type)**: `LINKING_APPROVED` —
  no different in kind from storing any other Highlightly-returned field, already
  covered by the existing terms review (§6.1: storage/use of API data permitted;
  §6.2 only prohibits building a competing database from systematic extraction,
  which a bounded per-game sync is not).
- **Storing/surfacing the canonical `url` (a link to the highlight's own YouTube
  watch page)**: `LINKING_APPROVED` — this is an outbound link to the rights
  holder's own official channel, the same posture already applied to every
  official-team RSS canonical URL.
- **Storing the `imgUrl` thumbnail reference** (never downloading it):
  `LINKING_APPROVED`, consistent with the M30A RSS thumbnail policy — a
  reference URL only, never fetched/rehosted by this application.
- **Publicly embedding the `embedUrl`** (rendering it as a live YouTube player in
  the product): was `EMBED_REVIEW_REQUIRED` as of M31/M31A. **Resolved in M31C**
  (§13) by explicit product instruction: embedding is now `EMBED_APPROVED`, but
  conditionally — only for the specific highlights the backend's own
  `embedStatus`/`canEmbed` evaluation marks `ALLOWED`, never unconditionally.
  Anything the backend cannot confirm safe (no geo result yet, `embeddable:
false`, an unrecognized restriction state, or country-scoped restrictions this
  backend does not yet resolve per-viewer) still falls back to the canonical
  link, exactly as before M31C.
- **Any form of downloading, rehosting, caching a video binary, proxying,
  circumventing geo-restriction, or removing NFL/YouTube branding**:
  `REHOSTING_NOT_ALLOWED` — never done, never attempted, and structurally
  impossible with this design since no direct media URL is ever stored (there
  isn't one to store).

`SourceRightsProfile`-equivalent status: unchanged. This milestone introduces no
new rights-approval record; the existing `HIGHLIGHTLY_EVALUATION_MODE`/
`HIGHLIGHTLY_PUBLICATION_APPROVED` production gate is unaffected by this feature
existing in the codebase (it governs Highlightly _data_ writes broadly, already
satisfied by this environment's configuration; it does not itself approve public
video embedding, which remains a separate, unresolved question above).

## 6. Live vs. FINAL behavior

One `IN_PROGRESS` game (SEA @ TEN) already had a highlight available at check
time during the original M31 evaluation. This is a real observation, not a
documentation claim — but it should not be over-generalized: the game had
almost certainly already finished broadcasting in real time (this
application's own `IN_PROGRESS` status simply hadn't been reconciled to
`FINAL` yet when the probe ran), and a full-game recap is naturally only ever
produced once a broadcast ends. Highlight sync is **not** attached to the
existing live poll cadence (`CURRENT_GAME_LIVE_POLL_SECONDS`,
`CURRENT_GAME_PREGAME_POLL_SECONDS`, `CURRENT_GAME_HALFTIME_POLL_SECONDS`) —
current evidence (one full-game recap per game, never play-level) doesn't
justify the extra Highlightly requests a live cadence would add, and M31A's
FINAL-only integration (§6A) directly proves no highlight call is ever made on
a `LIVE_FEATURED`/`LIVE_NORMAL`/`HALFTIME`/pregame tick.

## 6A. Automatic FINAL reconciliation (Milestone 31A)

Highlight sync is now wired into the exact same lifecycle
`CurrentGamePoller` already uses for team stats and authoritative FINAL play
replacement — no second scheduler was built. `CurrentGamePollerDependencies`
gained one new dependency, `highlightsService` (a narrow `HighlightSyncPort`
interface — `syncGame(gameId, { exhaustiveCheck })` — defined in
`current-game-poller.ts` itself so the `sports/` module never imports from the
`game-highlights/` domain module; a real `GameHighlightsService` instance
satisfies it structurally). The poller's own `finalReplacementPhase` (already
computed for FINAL play replacement, from `finalImmediateCompletedAt`/
`final10CompletedAt`/`final60CompletedAt`) directly gates whether a tick
attempts a highlight sync at all:

- **FINAL_IMMEDIATE** (first FINAL observation): one highlight-sync attempt,
  `exhaustiveCheck: false`. A zero-highlight result is stored as `PENDING`,
  not `UNAVAILABLE` — highlights may simply not be published yet.
- **FINAL_RECONCILE_10** (`CURRENT_GAME_FINAL_RECONCILE_10_MINUTES` later,
  default 10m): one more attempt, still `exhaustiveCheck: false`. Still
  `PENDING` on a zero result.
- **FINAL_RECONCILE_60** (`CURRENT_GAME_FINAL_RECONCILE_60_MINUTES` later,
  default 60m): one final attempt, `exhaustiveCheck: true`. Only now does a
  zero-highlight result become `UNAVAILABLE` — the lifecycle is exhausted, and
  `GameHighlightSyncState.coverage` durably records that an eligible completed
  game was checked and had nothing, distinct from `UNKNOWN` (never checked).
- **LIVE_FEATURED / LIVE_NORMAL / HALFTIME / pregame classes**: never
  attempted — the sync call sits behind `observedGame.status === 'FINAL' &&
finalReplacementPhase !== null`, which is false for every non-FINAL tick and
  false again for any stray FINAL tick after the lifecycle already completed
  (`finalReplacementPhase` is `null` once all three `*CompletedAt` fields are
  set). Proven by a dedicated test asserting zero highlight-sync calls on a
  LIVE tick and on a `SCHEDULED` candidate.

**Failure isolation** (§10 of the milestone): a highlight-sync exception or a
`PROVIDER_ERROR` result is recorded on the tick report (`highlights.ok`,
`highlights.errorMessage`) but is **deliberately excluded** from `overallOk`
(`gameStateOk && teamStats.ok && plays.ok`). This matters structurally, not
just cosmetically: `overallOk` decides whether `recordSuccess` (which carries
`finalTransition.pollStateUpdate` — the very fields that advance
`finalImmediateCompletedAt`/`final10CompletedAt`/`final60CompletedAt`) or
`recordFailure` (retry-with-backoff, which does _not_ advance those fields)
runs. If a highlight failure were allowed to flip `overallOk` to `false`, it
would silently stall the FINAL lifecycle itself and eventually prevent the
game from ever reaching `COMPLETE` — proven by a dedicated test that a
throwing highlight sync still leaves `gameState.ok`/`plays.ok` true,
`pollState.lastError` null, and `finalImmediateCompletedAt` set. A later
stage's successful check simply overwrites `GameHighlightSyncState` to
`AVAILABLE` (or `UNAVAILABLE`) — there is no permanent error "poisoning."

**Request economics, real measurement**: a genuine first-ever FINAL_IMMEDIATE
tick against a real, previously-unpolled preseason game (SEA @ TEN) reported
`requests: 3` for the whole tick — one game-state/schedule request, one shared
match-detail request (stats + plays), one highlight request — exactly the
conceptual FINAL cycle the milestone described, with **no duplicate or hidden
highlight fetch**. The same real run confirmed the pre-existing highlight row
for that game (persisted during the original M31 evaluation) was matched and
preserved rather than duplicated, and `GameHighlightSyncState.lastCheckedAt`
advanced to the new check time.

**Poll completion** (§12): because highlight outcomes never affect
`overallOk`, the existing `FINAL_IMMEDIATE → FINAL_RECONCILE_10 →
FINAL_RECONCILE_60 → COMPLETE` progression (`current-game-scheduling.ts`) is
completely unmodified and unaffected — a game reaches `COMPLETE` (and stops
being claimed by future poll cycles) on exactly the same schedule as before
M31A, regardless of whether a highlight was ever found. Manual re-sync
(`npm run games:highlights:sync`, `POST .../highlights/sync`) remains the way
to check again after that point — confirmed for real against PHI @ NE, whose
poll state had already reached `COMPLETE` under the _pre-existing_ (M27-era)
FINAL lifecycle before this milestone existed: a manual re-sync there is
idempotent (still exactly 1 stored highlight, `lastCheckedAt` advances) with
no poller involvement needed or attempted.

**Rate-limit degradation** (§11): reused as-is, no changes.
`shouldPollWhileDegraded` already preserves `FINAL_IMMEDIATE`/
`FINAL_RECONCILE_10`/`FINAL_RECONCILE_60` ticks (alongside `LIVE_FEATURED`)
when quota is degraded — since highlight sync now rides inside those same
ticks, it is naturally preserved right along with team stats/plays under
degradation, with no separate quota manager introduced.

## 7. Provider-neutral model

```ts
// src/modules/sports/game-highlight-normalization.ts
interface NormalizedGameHighlight {
  readonly providerHighlightKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly highlightType: 'GAME' | 'PLAY' | 'PLAYER' | 'OTHER';
  readonly thumbnailUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly embedUrl: string | null;
  readonly publishedAt: Date | null;
}
```

Adapted from the milestone's suggested shape by **removing** `directMediaUrl`
and a duration field — no provider evaluated so far (Highlightly) supplies
either, and the existing RSS precedent (M30A) is explicit that fields no real
source populates should not be added speculatively.

### Identity (§9)

**Precedence used: explicit provider highlight ID (1st choice).** Highlightly's
`id` (e.g. `105170`) is present on every sampled highlight, is stable across
repeated calls (confirmed: re-syncing the same game twice produced the same
`providerHighlightKey` and updated, not duplicated, the row), and needs no
canonical-URL-hash or field-hash fallback. `GameHighlight` enforces this via
`@@unique([provider, providerHighlightKey])`.

### Highlight type / play-level association (§12)

Every sampled highlight is deterministically classified `highlightType: 'GAME'`
— **not** derived from Highlightly's own `category` field, which was `"other"`
on 100% of the 25 highlights inspected across this evaluation and therefore
carries no real signal today. No sampled highlight, and nothing in the
documented response shape, includes a play/event ID, quarter, or clock —
**no deterministic association to a specific `GamePlay` is possible**, so per
the milestone's explicit instruction, no fuzzy title-to-play matching was
attempted and every highlight stores only `gameId`.

### Persistence

Introduced because real data justified it (one highlight per game, cleanly
mapped, real fields, real economics). Two new tables, both minimal:

- **`GameHighlight`** — `id`, `gameId` (FK → `Game`, cascade delete),
  `provider`, `providerHighlightKey`, `title`, `description`, `highlightType`,
  `thumbnailUrl`, `canonicalUrl`, `embedUrl`, `publishedAt` (always `null` for
  Highlightly today — no highlight-level publish timestamp exists, only the
  game's own kickoff date, which is not the highlight's publish time),
  `firstSeenAt`, `lastSeenAt`, `createdAt`, `updatedAt`. No raw provider payload
  is ever stored.
- **`GameHighlightSyncState`** — one row per game (not append-only history, unlike
  `GameDataHealthProbe`), storing exactly what a DB-only diagnostic read needs
  without ever triggering a live call itself: `coverage`, `lastCheckedAt`,
  `providerCount`, `requestCount`, `errorCode`.

### `Game` relationship (§11)

```text
Highlightly matchId
        ↓
GameProviderMapping (existing, reused as-is)
        ↓
internal Game.id
        ↓
GameHighlight.gameId
```

No new `Game` row is ever created from highlight data; a highlight sync with no
existing `GameProviderMapping` short-circuits to `PENDING` (no requests made),
identical in shape to the Data Health probe's `MISSING_PROVIDER_MAPPING`
short-circuit.

### Sync behavior (§13)

`GameHighlightsService.syncGame(gameId)` — mapping-first, exactly one bounded
provider request, deterministic identity, upsert (never destructive — a
provider snapshot that shrinks or temporarily omits a previously-seen highlight
never deletes that row; confirmed by a real database-integration test), and
metadata updates in place when a highlight's title/description/URLs change.
**No video binary is ever transferred** — the sync only ever touches the JSON
fields Highlightly's API itself returns. Reuses the same
`HighlightlyEvaluationHttpClient` instance as the rest of the current-game
sync/probe code (no second HTTP stack). Bounded CLI:
`npm run games:highlights:sync -- --gameId=<uuid>` or `--season=&seasonType=
[&week=]` (capped at 20 games per invocation, matching the M30D precedent of
raising rather than removing bulk-operation caps).

## 8. API

### Admin diagnostic (mirrors Data Health exactly)

- `GET /api/v1/admin/games/:gameId/highlights/diagnostic` (`VIEW_DATA_HEALTH`
  capability, same as Data Health's read routes) — **DB-only**, never calls
  Highlightly. Returns `{ gameId, dbHighlightCount, coverage, lastCheckedAt,
providerHighlightCount, requestCount, errorCode }`. No raw provider highlight
  key or match ID is included, even in this admin-only response — matching Data
  Health's own convention of reporting `providerMapping: { available: boolean }`
  rather than the raw provider game ID.
- `POST /api/v1/admin/games/:gameId/highlights/sync` (`PROBE_GAME_DATA`
  capability, same stricter gate as the Data Health probe) — the **only** route
  that makes a live Highlightly call for highlight metadata. Opening the
  diagnostic view never triggers one.
- `POST /api/v1/admin/games/:gameId/highlights/embed-refresh` (`PROBE_GAME_DATA`,
  M31C) — forces a recheck of embed eligibility for every existing highlight row
  on this one game, regardless of whether it was already decided. Never
  re-fetches `/highlights` metadata itself; only the geo-restrictions lookup
  runs, bounded to this one game's rows.

### Public

- `GET /api/v1/games/:gameId/highlights` → `{ gameId, coverage, highlights: [{
id, title, description, highlightType, thumbnailUrl, canonicalUrl, embedUrl,
canEmbed, publishedAt }] }`. `id` is the internal `GameHighlight` row's own
  UUID — the only identity ever exposed, matching the established convention
  (`game.dto.ts` never exposes a provider game ID either). No provider name,
  provider match ID, provider highlight ID, API key, raw geo-restriction
  payload, or raw response ever appears in this response (verified by an
  automated test asserting the serialized DTO never contains the string
  `"highlightly"` or any real provider ID value). `canEmbed` is the M31C
  addition — see §13.

### URL safety (§19)

Every stored/returned URL passes through `sanitizeHttpsUrl()`
(`game-highlight-normalization.ts`): parsed with the standard `URL` constructor,
kept only if `protocol === 'https:'`, otherwise stored/returned as `null`.
`javascript:`, `data:`, `file:`, and even plain `http:` URLs are rejected before
they ever reach the database (tested directly against those four cases). This is
a syntax/protocol check only — it never fetches the URL, unlike the SSRF-guarding
DNS resolution the news-inbox feed client performs before it actually requests a
feed URL, which does not apply here since these are reference-only YouTube links
never fetched by this backend.

### Duplicates and ordering (§21, §22)

A single provider response containing the same highlight ID twice was tested
directly against the real database and produces exactly one row (the unique
`(provider, providerHighlightKey)` constraint plus upsert-by-lookup logic
prevents the duplicate from ever being written twice). Repeated syncs are
idempotent (tested: three consecutive syncs of an unchanged snapshot produce zero
net row-count change after the first). Public ordering is `publishedAt` desc,
then `firstSeenAt` asc as a stable tiebreaker — chosen over "provider sequence"
because Highlightly's response never included an explicit sequence field, and
over "title text" because inventing chronology from title text was explicitly
out of scope.

## 9. Recommended frontend behavior

**As of M31 (this repository, backend-only): a highlight card (thumbnail +
title) that opens the canonical YouTube page (`canonicalUrl`) in a new
tab/window** — identical in spirit to how official-team RSS video cards
already work today. This was the only safe default before eligibility was
resolved.

**As of M31C (§13), the embed-rights question is resolved and the public API
now returns `canEmbed`.** The recommended frontend behavior (to be built in
the separate frontend project, not this one) is: `if (highlight.canEmbed &&
highlight.embedUrl) { /* mount an iframe lazily, on click */ } else { /*
canonical link, unchanged */ }`. The canonical link must remain visible even
when embedding, as a fallback. See §13 for the full contract.

## 10. Comparison with official-team RSS media (§24)

|                     | Official-team RSS (M30A–E)                                                    | Highlightly game highlights (M31)                          |
| ------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Content             | Team-produced: interviews, press conferences, mic'd up, occasional highlights | League-produced full-game recap, one per game              |
| Association         | None deterministic — advisory team-name/abbreviation matching only            | Deterministic — `GameProviderMapping` → internal `Game.id` |
| Storage model       | `NewsCandidate` (editorial review pipeline)                                   | `GameHighlight` (game/media data)                          |
| Play-level detail   | Never                                                                         | Never (no deterministic signal from either source)         |
| Canonical/thumbnail | Yes/yes                                                                       | Yes/yes                                                    |
| Embed URL           | Never provided by any RSS feed evaluated                                      | Yes (YouTube embed, rights review pending)                 |

These remain deliberately separate systems. Highlightly highlights are **not**
routed through `NewsCandidate` and never will be by this design — they belong to
`Game`/Game Center, not the editorial news inbox, per the milestone's explicit
instruction.

## 11. Manual operations remain available (Milestone 31A)

Automatic FINAL reconciliation (§6A) supplements, and never replaces, manual
tooling — both are unchanged from M31 and were re-verified for real in M31A:

- `npm run games:highlights:sync -- --gameId=<uuid>` or `--season=&seasonType=
[&week=]` (bounded, ≤20 games).
- `POST /api/v1/admin/games/:gameId/highlights/sync` (admin, `PROBE_GAME_DATA`).
- `GET /api/v1/admin/games/:gameId/highlights/diagnostic` (admin, DB-only,
  `VIEW_DATA_HEALTH`).
- `npm run games:highlights:embed-backfill -- --gameId=<uuid>` (or
  `--gameIds=<uuid,uuid,...>` / `--season=&seasonType=[&week=]`, bounded, ≤20
  games) and `POST /api/v1/admin/games/:gameId/highlights/embed-refresh`
  (admin, `PROBE_GAME_DATA`) — M31C's bounded repair/backfill for embed
  eligibility specifically, see §13.

These remain the only way to check a game once its poll state has reached
`COMPLETE` (the automatic path stops attempting by design at that point), and
the only way to re-evaluate a whole slate of already-`FINAL` games at once —
useful for operational repair, later backfill, provider corrections, and the
regular-season re-evaluation below. No season-wide backfill was run in M31A
(or M31) — only the small bounded real sample documented in §6A.

## 12. Regular-season re-evaluation gate

**RE-EVALUATE HIGHLIGHTLY HIGHLIGHTS WITH REAL 2026 REGULAR-SEASON GAMES.**

Every real sample in this document (M31 and M31A alike) is preseason data —
the 2026 regular season had not started as of this evaluation. Regular-season
behavior has not been observed and must not be assumed to match preseason
behavior. Once real `REG` games reach `FINAL`, specifically re-check:

- **Highlight count per game** — still exactly one full-game recap, or does
  the league publish more (quarter recaps, scoring-play clips) once games
  matter competitively?
- **`category` values** — still uniformly `"other"`, or does a real value
  (e.g. `touchdown-pass`, matching Highlightly's own documented example)
  finally appear, which would change the `highlightType` classification
  decision in `highlightly-highlight-normalizer.ts` (currently hard-coded to
  `GAME` because `category` carries no signal today).
- **Play-level association** — does any field newly appear (a play/event ID,
  quarter, clock) that would justify revisiting the "no deterministic
  `GamePlay` relation" decision in §12 of the original evaluation (still
  gameId-only in the schema)?
- **Metadata richness** — does `description` ever get populated (100% null in
  every preseason sample)?
- **Geo restrictions** — still `embeddable: true` with no blocked countries
  for every highlight, or does regular-season content carry real restrictions?
- **Embed behavior / rights posture** — M31C (§13) resolved embedding as
  conditionally approved based on preseason data only; re-run the embed
  eligibility backfill against real regular-season highlights and confirm
  `canEmbed`/`embedStatus` still come back `ALLOWED` at the same rate.
  Regular-season content is higher-value and may carry different geo/licensing
  terms than preseason recaps — do not assume `ALLOWED` carries over
  unverified.
- **Latency / request economics** — still ~150–400ms and negligible quota
  impact at real regular-season traffic (16+ FINAL games some weeks, all
  reconciling through the same three-stage FINAL lifecycle within a similar
  window)?

Do not invent or assume regular-season behavior before this re-evaluation
happens — every current design decision (single `GAME`-type highlight,
gameId-only association, canonical-link-only frontend recommendation) is
explicitly provisional on preseason-only real data.

## 13. Embed eligibility (Milestone 31C)

M31C resolves the `EMBED_REVIEW_REQUIRED` posture from §5 for this one
specific usage: **inline embedding is now allowed, but only for the exact
highlights the backend has explicitly evaluated as safe**, per this
milestone's own explicit product instruction. Canonical external linking
(§9) remains the fallback for everything else, and nothing about §5's
`REHOSTING_NOT_ALLOWED` posture changes — no video is ever downloaded,
rehosted, or proxied; only the existing `embedUrl` pointer Highlightly itself
returns is ever rendered, and only when eligible.

### Provider-neutral eligibility model

Two new persisted fields on `GameHighlight` (migration
`20260825120000_m31c_highlight_embed_eligibility`):

- **`embedStatus`** (`GameHighlightEmbedStatus`: `ALLOWED | NOT_ALLOWED |
GEO_RESTRICTED | UNKNOWN`) — the internal, provider-neutral reason.
- **`canEmbed`** (`boolean`) — the only field the public API needs; `true`
  only when `embedStatus === 'ALLOWED'` **and** an `embedUrl` exists.
- **`embedCheckedAt`** — when the decision was last made; `null` means never
  checked. No raw provider payload, and no allowed/blocked country list, is
  ever persisted — only the derived decision.

Classification logic (`embed-eligibility.ts`, pure and unit-tested):

| Input                                                          | `embedStatus`    | `canEmbed` |
| -------------------------------------------------------------- | ---------------- | ---------- |
| No `embedUrl`                                                  | `UNKNOWN`        | `false`    |
| Embed host outside an explicit allowlist (if configured)       | `NOT_ALLOWED`    | `false`    |
| No geo-restrictions result yet, or the lookup failed           | `UNKNOWN`        | `false`    |
| `embeddable: false`                                            | `NOT_ALLOWED`    | `false`    |
| `embeddable` missing/unrecognized                              | `UNKNOWN`        | `false`    |
| `embeddable: true`, non-empty allowed- or blocked-country list | `GEO_RESTRICTED` | `false`    |
| `embeddable: true`, no country scoping                         | `ALLOWED`        | `true`     |

`embeddable: true` is deliberately **not** treated as globally embeddable
when a country list is present (§7 of the product spec): this backend does
not resolve per-viewer country in M31C, so any country-scoped restriction
falls back to the external link rather than guessing.

### When the geo lookup runs

Never on a public page load. `GameHighlightsService.syncGame()` now also
evaluates eligibility for any highlight in that game lacking a prior
decision (`embedCheckedAt IS NULL`), immediately after the existing
`/highlights` upsert, using the same `HighlightlyEvaluationHttpClient`
instance (shared request/rate-limit tracking, no second HTTP stack). A
highlight already decided is **never** rechecked by a regular sync — this
keeps the FINAL-reconciliation request budget flat as highlights accumulate.
Geo lookups for multiple never-checked highlights in one game run through a
small fixed-size (4) concurrency pool rather than sequentially or
unbounded — moot for the one-highlight-per-game reality observed so far, but
bounded regardless if that ever changes.

A geo-lookup failure (network/HTTP error) degrades that one highlight to
`UNKNOWN`/`canEmbed: false` and is otherwise silent: it never fails the
highlight sync, never removes an existing highlight row, and — exactly like
every other highlight-sync outcome since M31A — never affects
`overallOk`/the FINAL-reconciliation lifecycle.

### Optional embed-host allowlist

`HIGHLIGHTLY_EMBED_HOST_ALLOWLIST` (comma-separated hostnames, default
`youtube.com,www.youtube.com,youtube-nocookie.com,www.youtube-nocookie.com`)
adds an extra, purely local safety check ahead of the geo lookup — a
disallowed host is rejected as `NOT_ALLOWED` without spending a provider
request at all. Setting it to an empty string disables the allowlist
entirely (HTTPS + `embeddable` + restriction state are still required).
It defaults to the hosts actually observed in every real sample so far, but
is intentionally configurable rather than hard-coded to YouTube, since
Highlightly's documentation does not guarantee every embeddable provider
will always be YouTube.

### Request economics (real measurement)

One geo-restrictions request per never-before-checked highlight, in addition
to the existing one `/highlights` request per sync:

```text
Highlight list request:      1  (unchanged since M31)
Geo restriction request:     1  (only for a highlight never checked before)
Total, first sync of a game: 2
Total, every later sync:     1  (already-decided highlights are never rechecked)
```

This does **not** change the FINAL-reconciliation lifecycle's request
pattern in shape, only its steady-state cost the first time a highlight is
seen: the real FINAL_IMMEDIATE tick measurement in §6A (3 requests: game
state, match detail, highlights) becomes 4 requests only on the tick that
first discovers a new highlight, and stays at 3 on every subsequent tick for
that game (the highlight was already decided). The bounded repair/backfill
CLI (`npm run games:highlights:embed-backfill`) and admin route (`POST
.../highlights/embed-refresh`) spend exactly one geo request per row they
touch, scoped to the games/rows passed in — never a season-wide scan.

### Real verification (SEA @ TEN, PHI @ NE) — and a real-playback correction

Run for real against both games already sampled in §2, via
`npm run games:highlights:embed-backfill -- --gameIds=<PHI@NE id>,<SEA@TEN id>`:

| Game                      | `embeddable` | Country scoping | `embedStatus` (persisted) | Embed host        |
| ------------------------- | ------------ | --------------- | ------------------------- | ----------------- |
| PHI @ NE (Preseason Wk2)  | `true`       | none            | `ALLOWED`                 | `www.youtube.com` |
| SEA @ TEN (Preseason Wk2) | `true`       | none            | `ALLOWED`                 | `www.youtube.com` |

Both real samples came back `embedStatus: ALLOWED` from Highlightly's own
geo-restrictions check. **However, when actually rendered in an iframe, both
of these real highlights failed to play**, with YouTube's own "Video
unavailable — this video contains content from NFL, who has blocked it from
display on this website or application" error. That message is YouTube's
_embedding-disabled-by-request_ error, not a geo-restriction error (which
reads "blocked it **in your country**") — it reflects a per-video/domain
embedding permission NFL controls directly in YouTube Studio, which
Highlightly's `/highlights/geo-restrictions/{id}` endpoint does not check or
expose at all. **2 of 2 real highlights checked failed to actually embed
despite `embedStatus: ALLOWED`.** This does not appear to be a
`localhost`-specific artifact: the error indicates the video's embedding is
either disabled entirely or restricted to an allow-list of approved domains,
neither of which is affected by whether the requesting page is a local or
production origin.

**Consequence — a global kill-switch, `HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED`
(default `false`)**: rather than rip out the eligibility pipeline (it still
computes and persists `embedStatus`/`canEmbed` correctly per Highlightly's
own contract, and may become useful again if this is a per-video or
preseason-only quirk), the public API applies one additional gate after the
stored decision — `toPublicGameHighlightDto(..., embedPlaybackEnabled)`
forces every `canEmbed` to `false` when this flag is off, regardless of the
persisted `embedStatus`. With it left at its default (`false`), both real
highlights now correctly report `canEmbed: false` on the public API, and the
canonical-link fallback (§9) is exactly what renders — confirmed live against
both games. Flipping `HIGHLIGHTLY_EMBED_PLAYBACK_ENABLED=true` re-enables the
per-highlight decision without any further backend/provider work, once real
playback is confirmed working for a meaningful sample (see §12's
regular-season gate, which now also covers this).

### Public API (unchanged privacy posture)

`PublicGameHighlightItemDto` gains exactly one field, `canEmbed: boolean` —
still no provider name, provider highlight ID, or raw geo-restriction
payload of any kind. `canEmbed` is computed defensively at the DTO boundary
as `embedPlaybackEnabled && highlight.canEmbed && highlight.embedUrl !== null`,
so neither a future bug in the persisted state nor the global kill-switch
being left off can ever report `canEmbed: true` without something safe to
embed.

### Frontend (not built in this repository)

This repository is backend-only; the milestone's Part B (an inline `iframe`
player in `GameHighlightCard`, lazy-mounted on click, external-link fallback
preserved, no custom controls) belongs to the separate frontend project and
was not implemented here. The public API contract above (`canEmbed` +
`embedUrl`) is exactly what that frontend work needs and requires no further
backend changes to consume.

### Official-team RSS video (unchanged)

This milestone applies only to `GameHighlight`. Official-team RSS video
content (§10) has no validated embed-eligibility contract of its own and
remains external-link-only — nothing here changes that.
