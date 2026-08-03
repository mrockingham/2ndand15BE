# Controlled news-source ingestion

The Milestone 13 inbox discovers candidate stories without turning third-party material into application content. All routes are private and all network work is manually triggered. A candidate never becomes public automatically.

```text
approved RSS/Atom feed or manual URL
  -> bounded candidate metadata
  -> editor review/save/dismiss
  -> editor-written CURATED draft
  -> existing CMS publication workflow
```

## Approved sources and permissions

The registry supports `RSS`, `ATOM`, and `MANUAL_ONLY`. New sources default to `PAUSED`; activating a source does not fetch it. Only an admin can create/edit/disable/pause/resume definitions. Editors and admins can view sources, run a source test, and manually ingest active/error sources. No source is created or activated from an inferred team-site URL.

No default live source is inserted by the migration. Local RSS and Atom files under `src/modules/news-inbox/fixtures` are fictional test inputs, not publisher configurations. A live feed belongs in the registry only after its URL, publisher behavior, stability, content type, and usage constraints are documented.

The bounded August 2 evaluation found ESPN's NFL RSS technically parseable and rejected NFL.com's `?format=rss` HTML response; neither was inserted. See [the evaluation record](source-evaluations/news-feeds-2026-08-02.md).

## Stored metadata and editorial states

Candidates retain a stable external ID when supplied, source/publisher snapshot, normalized canonical URL and SHA-256 identity, headline, at most 2,000 characters of plain-text source description, author, nullable source publication time, discovery time, suggestions, and review metadata. Full bodies, `content:encoded`, page HTML, paywalled text, images, video, scripts, cookies, credentials, and raw feed XML are not stored.

States are:

- `NEW -> REVIEWING | SAVED | DISMISSED | CONVERTED`
- `REVIEWING -> SAVED | DISMISSED | CONVERTED`
- `SAVED -> REVIEWING | DISMISSED | CONVERTED`
- `DISMISSED` and `CONVERTED` are terminal

Dismissal requires a retained reason. A later feed refresh may update metadata and `NEW` suggestions, but never reopens a dismissed candidate, resets a review state, or creates a second article for a converted candidate.

## URL identity and duplicates

Canonicalization lowercases the scheme/host through the standards-based URL parser, removes fragments and default ports, and removes only `utm_*`, `fbclid`, `gclid`, `mc_cid`, and `mc_eid`. Paths and all other query parameters remain unchanged. The service does not follow article URLs to discover publisher canonical tags.

Identity priority is stable source external ID, then exact canonical URL hash. A changed headline is metadata refresh, not identity. Headline similarity alone never silently merges candidates.

## Feed and XML controls

Feed URLs accept HTTP(S) without embedded credentials. Before each request and redirect, DNS answers are resolved and every address must be public; localhost, loopback, RFC1918/private, carrier-grade NAT, link-local, metadata, documentation, benchmarking, multicast, and reserved destinations are rejected. Redirects are manual and limited to three. Requests send a dedicated user agent plus XML accept headers, omit credentials, cookies, and authorization, and use a 10-second total timeout.

Responses are limited to 512 KiB and must use an expected RSS/Atom/XML type (or safely inspect as RSS/Atom XML). UTF-8 decoding is fatal. The SAX parser rejects all DOCTYPE/entity declarations, malformed XML/Unicode/control characters, nesting beyond 32, more than 100 entries, repeated scalar fields, missing titles/URLs, and unsafe description markup. Scripts, iframes, styles, event handlers, executable/data URLs, full-content fields, and arbitrary HTML are not persisted.

Each command writes at most 100 entries. One lease per source prevents overlapping runs; an abandoned lease is recoverable after 15 minutes. Conditional ETag/Last-Modified validators are retained privately and sent on later requests. HTTP 304 creates a successful zero-change run.

## Team suggestions

Suggestions use the configured default team, exact active full-team names, exact abbreviations, and the documented `WSH -> WAS` and `JAC -> JAX` aliases. City-only and fuzzy matching are deliberately absent. Suggestions are advisory and record their rule; candidate conversion accepts a separate editor-confirmed team-ID list.

## Manual operations

HTTP operations are documented in OpenAPI under `/api/v1/admin/news-sources` and `/api/v1/admin/news-candidates`. Manual candidate submission validates and stores the supplied metadata but does not fetch the URL.

The CLI runs one source by default and requires an auditable active editor/admin account:

```sh
npm run news:ingest -- --source=nfl-news --actor=editor@example.com
```

`--all` processes at most five active non-manual sources sequentially. There is no cron, recurring scheduler, background worker, queue, webhook, or continuous process.

## Candidate conversion and rights

Conversion requires an editor-written title and original summary. A summary identical to the stored source description is rejected. Optional original commentary is safe Markdown limited to 2,000 characters. The source name, canonical URL, and publication timestamp seed editable attribution fields. Hero metadata is supplied independently by the editor; nothing is copied or downloaded from the feed.

The transaction creates a `CURATED` `DRAFT`, confirmed article-team joins, revision 1, the normal compact CMS audit, the terminal candidate relationship, and a compact candidate-conversion audit. Editors remain responsible for attribution, copyright, trademarks, publisher terms, and image rights before publication.

## Known limitations

RSS/Atom publishers vary in standards compliance, timestamps, GUID stability, redirects, and description practices. Malformed or unsafe feeds fail closed. There is no ordinary-page fallback, full-text extraction, image proxy, social/email/video ingestion, automatic publication, AI summary, alerting, recurring scheduling, or frontend inbox in this milestone.
