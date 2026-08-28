# Team Homepage CMS (M39A)

M39A extends `GET /api/v1/teams/:teamId/hub` with one backend-authored `homepage` object. The read remains PostgreSQL-only: it uses derived-visible internal articles and the existing Game Center `displayVideos` composition. It never calls Highlightly, OpenAI, a feed, or another provider.

## Banner

`TeamHomepageConfig` stores one optional HTTPS image URL per internal team plus 0-100 focal coordinates and overlay opacity. The public defaults are `imageUrl: null`, centered `50/50`, and opacity `35`; a null image preserves the existing frontend banner fallback. Team colors remain sourced from `Team`.

## Editorial composition

Placements point to an internal `Article`, `GameHighlight`, or `GameCuratedVideo`; source metadata is not copied and provider IDs are never stored or exposed. The public union is discriminated by `type`: `ARTICLE` wraps the existing safe article card, while `VIDEO` contains safe media-card fields resolved from Game Center media.

The first valid explicit article is the normal lead. With no explicit valid article, the newest existing safe team-news card is the lead. Explicit items retain position order, recent team articles fill remaining supporting slots, duplicates and the featured item are removed, and supporting output is capped at eight.

Setting a video placement's `isLeadReplacement` to true atomically clears the previous selection. A partial unique database index also permits at most one true row per team. If that media becomes unavailable or no longer appears in `displayVideos`, public composition ignores it and automatically restores the normal article lead.

## Highlights

Each team has up to ten curated internal media pointers and optional settings. `displayLimit` is 3-10 (default 5) and `fillWithAutomatic` defaults true. Curated, currently eligible media is returned first. Automatic fill then considers recent games involving that team, selects at most one non-global `displayVideos` item per game, excludes curated media/games, and stops at the display limit. Disabling automatic fill returns curated-only. Stale placements are skipped without failing Team Hub.

## Administration

Editors and administrators reuse `VIEW_HOMEPAGE_CMS` and `MANAGE_HOMEPAGE_CMS` under `/api/v1/admin/teams/:teamId/homepage`. APIs cover the composed state, banner, editorial candidates/add/update/delete/reorder, highlight candidates/add/delete/reorder, and highlight settings. Candidate reads are bounded and database-only. Every mutation writes a compact `AdminAuditEvent`.

Lead selection uses atomic replacement because choosing a new lead completes the intended operator action in one request, while the database constraint protects concurrent writers.
