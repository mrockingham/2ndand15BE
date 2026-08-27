# Admin Game Media Curation (Milestone 32 / 32B)

M32 adds an operator-driven override for Game Center's media experience: an
admin can manually curate up to four embedded videos for a single game. This
is entirely independent of the Highlightly `GameHighlight` pipeline built in
M31/M31A/M31C -- curation never deletes, hides, mutates, or otherwise affects
automatic highlight sync, and removing every curated video automatically
falls back to the existing automatic experience.

**M32B** (see "Global Game Center video" below) adds a second, orthogonal
override: a single video an admin can configure once, that is then composed
into _every_ Game Center's media, without being copied into any per-game row
and without consuming any of the four-video per-game limit.

## Data model

`GameCuratedVideo` (`prisma/schema.prisma`, migration
`20260826140000_m32_game_curated_video`):

| Field                                   | Notes                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | Internal UUID -- the only identity ever exposed publicly.                                                                                                                 |
| `gameId`                                | FK to `Game`, cascade delete.                                                                                                                                             |
| `position`                              | `0..3`, contiguous. **The sole ordering/primary signal** -- there is no separate `isPrimary` column, so the two concepts can never disagree. `position === 0` is primary. |
| `title`                                 | Required, operator-entered, never scraped.                                                                                                                                |
| `embedUrl`                              | Required, HTTPS-only, host-allowlisted (see below). Never raw iframe HTML.                                                                                                |
| `canonicalUrl`                          | Optional HTTPS outbound link (e.g. the YouTube watch page). Never constructed automatically.                                                                              |
| `thumbnailUrl`                          | Optional HTTPS reference URL. Never scraped from the embed destination.                                                                                                   |
| `sourceLabel`                           | Optional freeform display label (e.g. "NFL", "Team Site"). Carries no rights/verification meaning.                                                                        |
| `createdById`/`updatedById`/`*Snapshot` | Same convention as `GameEditorialOverride`/`Article` -- nullable FK (`SetNull` on user deletion) plus an always-present email snapshot.                                   |

A unique `(gameId, position)` constraint keeps ordering integrity, and a
unique `(gameId, embedUrl)` constraint prevents exact duplicate videos on the
same game (the same video across _different_ games is allowed).

**Maximum four videos per game is enforced server-side**
(`MAX_CURATED_VIDEOS_PER_GAME` in `game-media-curation.repository.ts`),
inside the same transaction as the insert -- never relied on the frontend
alone. A fifth attempt returns `GAME_CURATED_VIDEO_LIMIT_REACHED` (409).

## Ordering and primary

`position 0` is primary; `1..3` are secondary, matching the Game Center
layout. Reordering (`PUT .../videos/order`) takes the admin's desired final
order as a list of video IDs and reassigns positions to match -- the first ID
in the list becomes primary. The reorder must include every one of the
game's current videos exactly once; a missing ID, an unrecognized ID, or a
duplicate ID is rejected with `GAME_CURATED_VIDEO_REORDER_MISMATCH` (422).

Reassigning positions goes through a temporary negative-position pass first,
because the `(gameId, position)` unique constraint is checked per-statement:
writing final positions directly can collide with another row's still-current
position mid-transaction (e.g. swapping positions 0 and 1).

Deleting a video compacts the remaining ones back to a contiguous `0..n-1` --
deleting position 0 promotes the former position 1 to primary automatically,
with no separate "reassign primary" step needed.

## Display mode and Game Center fallback

The public API (`GET /api/v1/games/:gameId/media`) exposes an explicit
`displayMode` so neither the admin UI nor Game Center has to infer override
precedence itself:

- **`CURATED`** -- at least one game-specific curated video exists. These are
  the primary Game Center media experience; automatic Highlightly highlights
  (and the global video, if active) are still returned in the same response
  but are not what Game Center leads with.
- **`AUTOMATIC`** -- no curated videos exist, but at least one automatic
  `GameHighlight` does. Unchanged from M31C behavior.
- **`GLOBAL`** (M32B) -- no curated videos and no automatic highlights exist,
  but the one cross-game global video (see below) is active. The global video
  becomes primary **only** in this sole-media-source case -- its mere
  presence never upgrades an existing `CURATED`/`AUTOMATIC` mode into
  something else (see "Global Game Center video" for the exact ordering
  rules).
- **`NONE`** -- nothing exists at all.

Removing the last curated video for a game automatically returns
`displayMode` to `AUTOMATIC`, `GLOBAL`, or `NONE` (whichever now applies) on
the very next read -- there is no separate "revert" action, because curation
is purely an additive, deletable override, never a replacement of the
underlying Highlightly data or the global video.

## Highlightly preservation

Creating, updating, reordering, or deleting a `GameCuratedVideo` never
touches `GameHighlight` or `GameHighlightSyncState` in any way -- the
repository methods for curated-video writes only ever operate on the
`game_curated_videos` table (plus `AdminAuditEvent`). Automatic Highlightly
sync during FINAL reconciliation (M31A) and the M31C embed-eligibility
pipeline continue running exactly as before, completely unaware that curated
overrides exist. Verified directly: a real DB integration test creates a
`GameHighlight` row, performs a full curate → override → delete-all cycle,
and asserts the highlight row is untouched and still present throughout.

## Embed URL security

Every embed/canonical/thumbnail URL is validated HTTPS-only
(`http:`/`javascript:`/`data:`/`file:`/malformed all rejected) via a Zod
schema, matching the `sanitizeHttpsUrl`/`httpUrl` conventions already used
elsewhere in this codebase. Only a URL is ever accepted -- raw iframe markup
(`<iframe src="...">`) is never a syntactically valid URL, so it is rejected
by the same schema check with no separate "no HTML" rule needed.

`embedUrl` additionally passes through a configurable host allowlist
(`GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST`, comma-separated hostnames,
defaulting to `youtube.com,www.youtube.com,youtube-nocookie.com,
www.youtube-nocookie.com`) before it is even checked against the database --
a disallowed host is rejected as `GAME_CURATED_VIDEO_HOST_NOT_ALLOWED` (422)
without ever reaching the write path. Setting the env var to an empty string
disables the allowlist entirely (any HTTPS embed URL is then accepted). The
allowlist is intentionally not hard-coded to YouTube, so other embeddable
providers can be enabled later purely by configuration. `canonicalUrl` and
`thumbnailUrl` are HTTPS-only but not host-restricted, since they are never
rendered in an iframe.

## Global Game Center video (Milestone 32B)

A single video an admin can configure once, that then appears in _every_
Game Center's media response -- distinct from `GameCuratedVideo` in every
respect that matters:

- **Model**: `GlobalGameCenterVideo` (`prisma/schema.prisma`, migration
  `20260827090000_m32b_global_game_center_video`). No `gameId` at all --
  it belongs to no one game. Same field shape as `GameCuratedVideo` minus
  `position` (there is nothing to order against): `title`, `embedUrl`,
  `canonicalUrl`, `thumbnailUrl`, `sourceLabel`, `isActive`,
  `createdById`/`updatedById`/`*Snapshot` (identical convention).
- **At most one row, ever.** `PUT /api/v1/admin/game-media/global-video`
  (`GameMediaCurationService.setGlobalVideo` /
  `GlobalGameMediaRepository.upsert`) always checks for an existing row
  first and updates it in place rather than inserting a second one -- there
  is no unique-constraint trick needed to enforce this because the service
  never attempts a bare `create` when a row already exists. This is what
  makes `PUT` idempotent: calling it repeatedly replaces the same
  configuration rather than accumulating rows.
- **Never copied into `Game` rows.** Adding, replacing, or removing the
  global video performs exactly one write to `global_game_center_videos`
  (plus one `AdminAuditEvent`) -- never touches `games`, `game_curated_videos`,
  `game_highlights`, or `game_highlight_sync_state` in any way, regardless of
  how many games exist. The public per-game response composes it in
  dynamically at read time (see below), so a game created _after_ the global
  video was configured still gets it automatically, with zero backfill.
- **Does not consume the four-video per-game limit.** A single game can
  therefore show up to five selectable videos: four game-specific curated
  videos plus the one global video. This is intentional (M32B spec §4).
- **Security**: identical HTTPS + host-allowlist validation as
  `GameCuratedVideo`, reusing the exact same `httpsUrl` Zod helper and
  `isAllowedEmbedHost`/`GAME_CURATED_VIDEO_EMBED_HOST_ALLOWLIST` check (no
  separate global-video allowlist config) -- see "Embed URL security" above.
- **Permissions**: reuses `VIEW_GAME_MEDIA` (EDITOR + ADMIN) for
  `GET .../global-video` and `MANAGE_GAME_MEDIA` (ADMIN only) for
  `PUT`/`DELETE .../global-video` -- no new capability was introduced.
- **Audit**: `GLOBAL_GAME_MEDIA_CREATED` (first `PUT`),
  `GLOBAL_GAME_MEDIA_UPDATED` (every subsequent `PUT`), and
  `GLOBAL_GAME_MEDIA_REMOVED` (`DELETE`), `entityType: 'GLOBAL_GAME_MEDIA'`,
  same before/after-snapshot convention as every other write in this module.

### Ordering rules

The backend returns a single provider-neutral ordered list, `displayVideos`
(see Public API below), so a frontend never has to reimplement this
precedence:

| Existing media                          | Order                                           | `displayMode` |
| --------------------------------------- | ----------------------------------------------- | ------------- |
| None                                    | `[GLOBAL]`                                      | `GLOBAL`      |
| One automatic highlight `A0`            | `[A0, GLOBAL]`                                  | `AUTOMATIC`   |
| Several automatic highlights `A0..An`   | `[A0, GLOBAL, A1, ..., An]`                     | `AUTOMATIC`   |
| Curated videos `C0..Cn` (primary first) | `[C0, GLOBAL, C1, ..., Cn]`                     | `CURATED`     |
| No active global video                  | unchanged from M32 (no `GLOBAL` entry anywhere) | unaffected    |

The global video is **always the second entry** whenever any game-specific
media exists, regardless of how many curated videos or automatic highlights
there are -- never hard-coded to "exactly one automatic highlight" (real
Highlightly data happens to be exactly that today, but the composition logic
generalizes to any count). It becomes the **first and only** entry solely in
the no-game-specific-media case. `composeDisplayVideos()` in
`game-media-curation.dto.ts` is the single place this rule is implemented.

## Admin API

Mounted at `/api/v1/admin/game-media`. Viewing requires `VIEW_GAME_MEDIA`
(EDITOR + ADMIN); every mutation requires `MANAGE_GAME_MEDIA` (ADMIN only) --
matching the `VIEW_DATA_HEALTH`/`PROBE_GAME_DATA` split already used for Data
Health and the `GameHighlight` admin sync route.

| Method   | Path                               | Capability          |
| -------- | ---------------------------------- | ------------------- |
| `GET`    | `/games?season=&seasonType=&week=` | `VIEW_GAME_MEDIA`   |
| `GET`    | `/games/:gameId`                   | `VIEW_GAME_MEDIA`   |
| `POST`   | `/games/:gameId/videos`            | `MANAGE_GAME_MEDIA` |
| `PATCH`  | `/videos/:videoId`                 | `MANAGE_GAME_MEDIA` |
| `PUT`    | `/games/:gameId/videos/order`      | `MANAGE_GAME_MEDIA` |
| `DELETE` | `/videos/:videoId`                 | `MANAGE_GAME_MEDIA` |
| `GET`    | `/global-video`                    | `VIEW_GAME_MEDIA`   |
| `PUT`    | `/global-video`                    | `MANAGE_GAME_MEDIA` |
| `DELETE` | `/global-video`                    | `MANAGE_GAME_MEDIA` |

The game-listing endpoint is DB-only (no Highlightly calls) and returns, per
game: internal ID, kickoff, status, home/away team, score, `curatedVideoCount`,
`automaticHighlightCount`, `hasGlobalVideo` (a boolean, **not** a count -- the
one global video is shared, so a per-game count would misleadingly imply a
per-game copy exists), and `displayMode` -- enough for the admin UI to render
status badges without a second request per game. The game detail response
additionally includes the full `globalVideo` object (or `null`), so an admin
screen can show e.g. "Game-specific curated videos: 2 / Automatic highlights:
1 / Global video: active" without a second request.

Every mutation is written to `AdminAuditEvent` (`entityType:
'GAME_CURATED_VIDEO'` for per-video actions, `'GAME'` for the game-scoped
reorder, `'GLOBAL_GAME_MEDIA'` for the global-video endpoints) with
before/after snapshots, matching the existing `admin.repository.ts` audit
convention exactly (`createAudit` helper, sanitized snapshots, actor email
always captured even if the user is later deleted).

## Public API

`GET /api/v1/games/:gameId/media` -- provider-neutral, requires no
authentication:

```jsonc
{
  "gameId": "...",
  "displayMode": "CURATED" | "AUTOMATIC" | "GLOBAL" | "NONE",
  "curatedVideos": [
    { "id", "position", "isPrimary", "title", "embedUrl", "canonicalUrl", "thumbnailUrl", "sourceLabel" }
  ],
  "highlights": [ /* unchanged PublicGameHighlightItemDto[] from M31C */ ],
  "globalVideo": { "id", "title", "embedUrl", "canonicalUrl", "thumbnailUrl", "sourceLabel" } | null,
  "displayVideos": [
    {
      "id", "mediaType": "CURATED" | "AUTOMATIC" | "GLOBAL",
      "title", "embedUrl", "canonicalUrl", "thumbnailUrl", "sourceLabel", "canEmbed"
    }
  ],
  "coverage": "AVAILABLE" | "PENDING" | "UNAVAILABLE" | "PROVIDER_ERROR" | "UNKNOWN"
}
```

`curatedVideos`, `highlights`, and `coverage` are exactly what M32/M31C
already returned -- **unchanged, additive-only extension**, so nothing that
already consumes this endpoint breaks. `globalVideo` and `displayVideos` are
the two new M32B fields. **`displayVideos` is the one a frontend should
actually render from** -- it already encodes the full CURATED/AUTOMATIC/
GLOBAL precedence and ordering, including a `canEmbed` per item (`true` for
every `CURATED`/`GLOBAL` entry, since those are operator-approved at write
time; passed through from Highlightly's own eligibility check for `AUTOMATIC`
entries -- see the M31C embed-eligibility doc).

Never includes creator/updater user IDs, audit metadata, provider names, or
provider highlight IDs -- matching the existing privacy convention for every
other public Game Center endpoint.

## What was intentionally not built

- No thumbnail scraping or automatic canonical-URL construction -- both are
  manual, optional operator input, for both game-specific and global videos.
- No iframe-embeddability pre-check against the provider (e.g. YouTube's
  oEmbed endpoint) before saving -- an operator is expected to verify
  playback themselves before curating a video, exactly as they would for any
  other manually-entered external link.
- No global video _playlist_ -- V1 supports exactly zero or one active
  global video, by design (M32B spec §2), not an ordered list of several.
- No frontend admin UI or Game Center rendering -- this milestone is
  backend-only; the public API contract above (particularly `displayVideos`)
  is what a frontend needs to build both.
