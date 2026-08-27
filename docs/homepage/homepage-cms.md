# Homepage CMS (Milestone 35A)

M35A upgrades the homepage from fixed presentation into a small, controlled
CMS: an editable Hero carousel, homepage Top Story curation of `Article`s, an
efficient Highlights section, a Passing/Rushing/Receiving leaders section,
and one composed public endpoint, `GET /api/v1/homepage`, so the frontend
never makes N+1 requests to assemble the page. Backend-only -- no frontend
work was done in this milestone.

## Hero carousel

### Data model

Three tables, `prisma/schema.prisma` (migration `20260827120000_m35a_homepage_cms`):

- **`HomepageHeroSlide`** -- `position` (0..N, contiguous, the sole
  ordering/primary signal -- no separate `isPrimary` column), `isActive`,
  `imageUrl`, `imageAlt`, and six presentation-only fields:

  | Field             | Range   | Default | Meaning                           |
  | ----------------- | ------- | ------- | --------------------------------- |
  | `imageBrightness` | 25-150  | 100     | Percent, 100 = unmodified         |
  | `imageContrast`   | 50-150  | 100     | Percent, 100 = unmodified         |
  | `imageSaturation` | 0-200   | 100     | Percent, 0 = grayscale            |
  | `overlayOpacity`  | 0-100   | 0       | Percent, 0 = no overlay           |
  | `focalPointX/Y`   | 0-100   | 50      | Normalized percent, 50 = centered |
  | `imageScale`      | 100-200 | 100     | Percent, 100 = no zoom            |

  Every one of these is a **display instruction applied at render time, never
  a modification of the stored image file** -- resetting all of them to their
  defaults leaves `imageUrl` completely unaffected, satisfying "non-destructive
  editing" (M35A spec §8). `imageUrl` follows the same convention as every
  other image field in this codebase (`Article.heroImageUrl`, `Team.logoUrl`,
  `GameHighlight.thumbnailUrl`, `GameCuratedVideo.thumbnailUrl`): a nullable
  externally-hosted **HTTPS-only URL string**. There is no image upload/
  storage service anywhere in this codebase, so none was added here --
  operators supply a URL, exactly as for every other image field.

- **`HomepageHeroContentBlock`** -- up to nine per slide, one per
  `HomepageHeroContentSlot` (`TOP_LEFT` .. `BOTTOM_RIGHT`, a fixed 3x3 grid --
  never arbitrary pixel coordinates, so responsive rendering stays
  predictable). `content` is a constrained JSON rich-text document (see
  below), never raw HTML. Unique `(heroSlideId, slot)`.

- **`HomepageHeroCta`** -- 0-2 per slide, `position` (0 or 1), `label`, `url`,
  `variant` (`PRIMARY`/`SECONDARY`). This generalizes what was previously the
  hard-coded "Slide 1's two buttons" -- any slide may have 0-2 CTAs; there is
  no schema-level restriction tying CTAs to a specific slide. If the product
  wants CTAs only on the first slide, that is a frontend/content decision, not
  a backend one.

### Rich text: a closed JSON document model

No existing structured rich-text format exists elsewhere in this codebase
(`Article.body` is sanitized Markdown text, not JSON), so M35A introduces one,
deliberately small: `src/modules/homepage/homepage-rich-text.ts`.

```text
doc
 └─ children: (paragraph | heading)[]      max 20 blocks
     ├─ align?: left | center | right
     └─ children: (text | link)[]          max 40 inline nodes
         text:  { text: string (≤500 chars), marks?: (bold | italic)[] }
         link:  { href: internal path "/..." or https:// URL, children: text[] }
```

There is **no `script`/`iframe`/custom-HTML node type at all** -- not
"sanitized out" at write time by a blocklist, but structurally impossible to
express in the first place, which is a stronger guarantee than a sanitizer
that might miss an edge case. Validated by `heroRichTextDocumentSchema`
(Zod), `.strict()` at every level (an unrecognized field anywhere in the
document is rejected). `href` uses the same "internal path or https://"
validator as CTA `url` (see below) -- `http:`/`javascript:`/`data:`/`file:`
and protocol-relative `//host` links are all rejected.

### CTA / link URL safety

Both CTA `url` and rich-text link `href` accept **either** an internal
relative path (must start with `/`, and not `//`, which browsers treat as an
external protocol-relative URL) **or** an external `https://` URL. Never
`http:`, `javascript:`, `data:`, or `file:`. A raw `<iframe>` string is never
a syntactically valid URL, so it is rejected by the same check -- no separate
"no HTML" rule is needed.

### 3-10 slide behavior

`MAX_HERO_SLIDES = 10` is enforced server-side
(`HOMEPAGE_HERO_SLIDE_LIMIT_REACHED`, 409) on create. The product target of
**3-10 active slides for a publish-ready homepage is advisory, not
enforced** -- an admin may have 0, 1, or 2 active slides while still setting
up content, and no write is ever blocked because of it. The admin hero-list
response includes a `meta` block:

```jsonc
{ "slides": [...], "meta": { "activeCount": 2, "totalCount": 3, "readyForPublish": false } }
```

`readyForPublish` is `true` once `activeCount >= 3` -- purely informational,
for an admin UI banner. The **public** endpoint returns however many active
slides safely exist (including zero), and the frontend is expected to
preserve its current fallback hero when the array is empty or short (M35B,
not built here).

### Ordering, activation, and deletion

`PUT /admin/homepage/hero/order` takes the full ordered list of slide IDs
(every current slide, each exactly once) and reassigns positions to match --
the first ID becomes primary (position 0). A partial or mismatched list is
rejected with `HOMEPAGE_HERO_SLIDE_REORDER_MISMATCH` (422). Reassignment goes
through the same two-phase (temporary-negative-then-final) position update as
`GameCuratedVideo`/`HomepageTopStory`, because the `position` unique
constraint is checked per-statement.

Deleting a slide compacts the remaining ones back to a contiguous `0..n-1`.
Activating/deactivating a slide is just `PATCH { isActive }` -- there is no
separate activate/deactivate endpoint; the audit trail
(`HOMEPAGE_HERO_SLIDE_UPDATED`, before/after snapshot) already shows the flip
clearly.

### Content blocks and CTAs are edited via slide PATCH, not sub-endpoints

Per M35A spec §11, `POST /admin/homepage/hero` and
`PATCH /admin/homepage/hero/:slideId` accept `contentBlocks`/`ctas` as sibling
fields alongside the image fields, in one transactional write:

```jsonc
{
  "imageUrl": "https://...",
  "contentBlocks": [{ "slot": "MIDDLE_LEFT", "content": { "type": "doc", "children": [...] } }],
  "ctas": [{ "label": "Read more", "url": "/articles/foo" }]
}
```

When `contentBlocks`/`ctas` is provided on a `PATCH`, it is a **full
replacement** of that slide's set, not a partial merge -- there are no
separate per-block or per-CTA endpoints.

## Top Story curation

**Deliberately a separate table, `HomepageTopStory`, not an
`Article.isTopStory` boolean.** `Article.isFeatured` already exists for a
different editorial-featuring concept (used elsewhere in the article admin
UI); overloading or reusing it for homepage placement would conflate two
independent product decisions. `articleId` is `@unique`, so an article can be
curated at most once; `position` (0 = lead story) is the sole ordering
signal, capped at `MAX_TOP_STORIES = 6`
(`HOMEPAGE_TOP_STORY_LIMIT_REACHED`, 409).

- `PUT /admin/homepage/top-stories/:articleId` -- mark (idempotent: marking
  an already-curated article returns the existing row rather than erroring
  or creating a duplicate). Only checks the article **exists** (any status),
  not that it is currently public -- an operator may curate a
  DRAFT/SCHEDULED article ahead of its publish time.
- `DELETE /admin/homepage/top-stories/:articleId` -- unmark (also idempotent:
  unmarking a non-curated article is a harmless no-op, 204).
- `PUT /admin/homepage/top-stories/order` -- full reorder, same exact-set-match
  validation as Hero slides.

**Article preservation**: none of the above ever touches `Article`,
`NewsCandidate`, or provenance data -- `HomepageTopStory` is purely a
placement pointer. Verified directly by a real DB integration test that
curates a real Article, unpublishes it, and confirms the Article row and the
curation row both remain completely intact throughout.

**Public eligibility** (M35A spec §18): the public homepage silently excludes
a curated article that is not currently publicly visible (not `PUBLISHED`
past its `publishedAt`, or `SCHEDULED` past its `scheduledFor` -- the same
rule as `article.repository.ts`'s `publicVisibilityWhere`). This is
re-evaluated on every public read, not cached at curation time -- an article
unpublished after being curated disappears from the homepage automatically,
with no error and no broken reference, while the curation row and the admin
list are untouched.

## Highlights

No new table. Computed from existing infrastructure at read time:

1. `HomepageRepository.findRecentGamesWithMedia(limit)` queries the most
   recent `FINAL` games that already have **at least one** `GameCuratedVideo`
   or `GameHighlight` row (`ORDER BY startTime DESC`, bounded to
   `HOMEPAGE_HIGHLIGHTS_LIMIT = 8` -- never a season-wide scan).
2. For each of those (at most 8) games, the service calls the **existing**
   `GameMediaCurationService.getPublicGameMedia(gameId)` -- the exact same
   composition Game Center itself uses (curated/automatic precedence, M31C
   embed-eligibility, M32B global-video insertion) -- and takes the first
   `displayVideos` entry whose `mediaType !== 'GLOBAL'`.
3. Because `findRecentGamesWithMedia` only ever selects games that already
   have game-specific media, that first non-GLOBAL entry always exists (a
   defense-in-depth filter still guards against it regardless).

This means the homepage Highlights section can never repeat the M32B global
video once per game -- **it is never surfaced on the homepage at all**, since
every homepage highlight is deliberately picked from the non-GLOBAL entries
of each game's media. No Highlightly calls, no RSS calls -- entirely DB-backed
via the same public contracts other modules already expose.

Public shape (`PublicHomepageHighlightDto`):

```jsonc
{
  "gameId": "...", "title": "...", "thumbnailUrl": "...", "canonicalUrl": "...",
  "embedUrl": "...", "canEmbed": true, "mediaType": "CURATED" | "AUTOMATIC",
  "awayTeam": { "id", "fullName", "abbreviation", "logoUrl", "primaryColor", "secondaryColor" },
  "homeTeam": { ... }, "gameDate": "2026-08-22T23:00:00.000Z"
}
```

No provider IDs. Links to the game via `gameId` -- the frontend is expected
to route to that game's Game Center as the primary action.

## Leaders (Passing / Rushing / Receiving)

Reuses the existing `stats-hub` module's `getSeasonLeaders` entirely --
**no duplicate stats computation was built**. One call per category
(`passing_yards`, `rushing_yards`, `receiving_yards`), each with `limit: 3`,
`seasonType: 'REG'`.

**Season resolution is the one subtlety here.** `stats-hub`'s own coverage
notes are explicit: only imported historical seasons (2020-2025 at the time
of writing) have real player statistics; there is no live current-season
(`CURRENT_NFL_SEASON`, e.g. 2026) player data at all yet. So the leaders
season is **not** `config.sports.currentNflSeason` -- it is the **latest
season stats-hub actually has imported data for**, read from
`StatsHubReader.getMetadata()`'s `availableSeasons` and taking the maximum.
`fallbackSeason` (`config.sports.currentNflSeason`, injected) is used only if
`availableSeasons` is ever empty, in which case every category legitimately
returns `[]` rather than fabricating anything. The resolved season and
`seasonType: 'REG'` are always returned in the response so the frontend never
has to guess:

```jsonc
{ "season": 2025, "seasonType": "REG", "passing": [...], "rushing": [...], "receiving": [...] }
```

Each leader row:

```jsonc
{
  "rank": 1,
  "player": { "id", "displayName", "position", "positionGroup", "headshotUrl" },
  "team": { "id", "abbreviation", "fullName" } | null,
  "value": 4500
}
```

`team` is `null` for a player with a `MULTI`/`NONE` team context that season
(e.g. mid-season trade) -- never guessed. Touchdowns were **not** added
alongside yards: `stats-hub`'s ranking is computed via a single-metric SQL
`RANK() OVER (...)` per call, so attaching a second metric's value per row
would require either a second query per player or a raw join -- not "cheap,"
so it was left out of V1 per the milestone's explicit instruction to avoid
unnecessary duplicate stats computation. `StatsHubReader`'s own public
contract types both `getSeasonLeaders`/`getMetadata` as `Promise<unknown>`
(the existing stats-hub controller just forwards the response body as-is);
`HomepageService` validates the real shape defensively at the boundary
(`readLeaderRows`/`readAvailableSeasons`) rather than trusting a blind cast,
and degrades to an empty array/fallback season rather than throwing if the
shape is ever unexpected.

## Public API

`GET /api/v1/homepage` -- one request, DB-backed, no live provider calls:

```jsonc
{
  "heroSlides": [ /* PublicHeroSlideDto[] -- active slides only, in position order */ ],
  "topStories": [ /* PublicTopStoryDto[] -- publicly-eligible articles only, in position order */ ],
  "highlights": [ /* PublicHomepageHighlightDto[], bounded to 8, most-recent-FINAL-game-first */ ],
  "leaders": { "season": 2025, "seasonType": "REG", "passing": [...], "rushing": [...], "receiving": [...] }
}
```

Composed via a single `Promise.all` fan-out across four independent,
DB-only, already-bounded queries (Hero, Top Stories, Highlights, Leaders) --
matching the `TeamHubService.getOverview` composition precedent already used
elsewhere in this codebase. Never exposes admin user IDs, audit metadata, raw
rich-text beyond the structured document itself, provider IDs, or private
News/NewsCandidate metadata.

### Admin API

Mounted at `/api/v1/admin/homepage`. `VIEW_HOMEPAGE_CMS` and
`MANAGE_HOMEPAGE_CMS` are both granted to **EDITOR and ADMIN** -- homepage
curation is editorial content management, matching the
`EDIT_ARTICLE`/`PUBLISH_ARTICLE` precedent (both EDITOR-accessible), not the
ops-oriented `PROBE_GAME_DATA`/`REPAIR_GAME_PLAYS` ADMIN-only split used for
Data Health/game-highlights sync.

| Method   | Path                      | Capability            |
| -------- | ------------------------- | --------------------- |
| `GET`    | `/hero`                   | `VIEW_HOMEPAGE_CMS`   |
| `GET`    | `/hero/:slideId`          | `VIEW_HOMEPAGE_CMS`   |
| `POST`   | `/hero`                   | `MANAGE_HOMEPAGE_CMS` |
| `PATCH`  | `/hero/:slideId`          | `MANAGE_HOMEPAGE_CMS` |
| `DELETE` | `/hero/:slideId`          | `MANAGE_HOMEPAGE_CMS` |
| `PUT`    | `/hero/order`             | `MANAGE_HOMEPAGE_CMS` |
| `GET`    | `/top-stories`            | `VIEW_HOMEPAGE_CMS`   |
| `PUT`    | `/top-stories/order`      | `MANAGE_HOMEPAGE_CMS` |
| `PUT`    | `/top-stories/:articleId` | `MANAGE_HOMEPAGE_CMS` |
| `DELETE` | `/top-stories/:articleId` | `MANAGE_HOMEPAGE_CMS` |

(`/top-stories/order` is registered before `/top-stories/:articleId` since
both are `PUT` and Express matches route order.)

Every mutation is written to `AdminAuditEvent` (`entityType:
'HOMEPAGE_HERO_SLIDE'` for Hero create/update/delete/reorder,
`'HOMEPAGE_TOP_STORY'` for mark/unmark/reorder), matching the
`createAudit`-per-module convention already used by
`game-media-curation.repository.ts`/`global-game-media.repository.ts`/
`admin.repository.ts`.

## Cacheability

The public endpoint is safe for normal short-lived HTTP/CDN/browser caching
(no per-user personalization, no cookies read). No cache invalidation
webhook or explicit `Cache-Control` header was added in this milestone --
recommend a short TTL (on the order of 30-60 seconds) at the edge/CDN layer
if one is introduced later, so an admin change is visible within that window
without needing an explicit purge. Do not cache for hours: Hero/Top Story
edits are expected to be visible promptly.

## What was intentionally not built

- No image upload/storage service -- `imageUrl` is a URL string, matching
  every other image field in this codebase.
- No rich-text WYSIWYG editor -- this is a backend contract only; a frontend
  editor would serialize to/from `HeroRichTextDocument`.
- No touchdown counts alongside leader yards (see "Leaders" above).
- No frontend Homepage CMS admin UI or homepage rendering -- M35A is
  backend-only; M35B (not built here) is the frontend milestone.
