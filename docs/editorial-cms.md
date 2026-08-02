# Editorial CMS

The internal CMS stores original and curated editorial records in PostgreSQL. It does not scrape, fetch, proxy, upload, summarize, or automatically publish third-party content. Administrative routes require a current persisted `EDITOR` or `ADMIN` role; public routes expose only content that satisfies the derived visibility rule.

## Types and content rules

- `ORIGINAL` requires an original summary and Markdown body.
- `CURATED` requires a source name, HTTP(S) source URL, and original summary. Optional editorial commentary is limited to 2,000 characters; copied third-party bodies are prohibited.
- `ANNOUNCEMENT` requires an internally authored Markdown body.

Markdown is normalized to NFC and LF line endings. Embedded HTML, control characters, malformed Unicode, scripts, iframes, and unsafe URL protocols are rejected at the API boundary. Public DTOs return Markdown source, so frontend clients must still render it through a maintained safe Markdown renderer and must not enable raw HTML.

Hero images are external URL metadata only. A URL requires meaningful alt text. Attribution text and an attribution URL may be stored, but the server never downloads or proxies the image. Editors remain responsible for publication, trademark, copyright, and image-reuse rights.

## Lifecycle and scheduling

Every article starts as `DRAFT`. Explicit operations implement these transitions:

```text
DRAFT -> PUBLISHED | SCHEDULED | ARCHIVED
SCHEDULED -> PUBLISHED | UNPUBLISHED | ARCHIVED
PUBLISHED -> UNPUBLISHED | ARCHIVED
UNPUBLISHED -> PUBLISHED | SCHEDULED | ARCHIVED
ARCHIVED -> UNPUBLISHED (admin restore only)
```

Publishing sets `publishedAt`; republishing preserves the first publication timestamp. Scheduling requires a future timestamp with an explicit offset. There is no worker: public reads derive visibility for `SCHEDULED` records when `scheduledFor <= now` without changing database state during a GET. Before that instant, drafts, unpublished, scheduled, and archived content return `404` by slug and never appear in lists.

Edits, team changes, and lifecycle operations require `expectedVersion`. Every successful mutation increments the version and creates an immutable numbered revision in the same transaction. A stale version returns `409`; archived articles must be restored before editing. Slugs are unique, normalized, and immutable after first publication.

## Teams, featured placement, and public reads

Articles may tag zero or more distinct active NFL teams by internal UUID. Tags are returned in abbreviation order, and public/admin lists can filter by internal team ID; public lists also accept an abbreviation, including the documented `WSH -> WAS` and `JAC -> JAX` aliases. Provider mappings remain private.

Featured records support priority `1..1000` and optional start/end instants. `GET /api/v1/articles/featured` returns only currently active placements, ordered by ascending priority, effective publication time, and internal ID. Public list limits are at most 50, administrative limits are at most 100, and public candidate resolution fails explicitly above 500 records rather than returning a silently incomplete page.

Public routes are:

```text
GET /api/v1/articles
GET /api/v1/articles/featured
GET /api/v1/articles/:slug
GET /api/v1/teams/:teamId/articles
```

List DTOs omit bodies. Public detail DTOs omit lifecycle internals, scheduling metadata, versions, revisions, actor identities, and audit fields. Responses use a short cache policy (`max-age=60`, `stale-while-revalidate=300`) without Redis.

## Administrative API and permissions

Editors can list and preview all non-archived content, create/edit drafts or published content, manage team tags and featured metadata, publish/unpublish/schedule, and read article revisions. Admins additionally archive and restore records. Permanent deletion is not exposed.

Administrative routes live under `/api/v1/admin/articles`; exact request and response schemas are in OpenAPI. Article-scoped audit events are available to editors through `/api/v1/admin/audit-events?entityType=ARTICLE&entityId=<article-id>`. Only admins may omit the article identity or read the complete administrative audit trail.

Each meaningful change stores a full editorial revision, including team IDs and publication metadata. `AdminAuditEvent` stores only compact status/title metadata, body length, and a SHA-256 body digest; it does not duplicate large article bodies. Revisions and audit events have no update/delete API and retain nullable actor relations plus actor snapshots.

## Explicit exclusions

This milestone adds no CMS frontend, media handling, rich-text HTML, scraping, RSS/news API integration, AI drafts or summaries, cron jobs, queues, Redis, notifications, provider synchronization, or production deployment changes.
