# Controlled news-source ingestion

The Milestone 13 inbox discovers candidate stories without turning third-party material into application content. All routes are private and all network work is manually triggered. A candidate becomes public only through editor review/conversion, or -- as of Milestone 42B, and only for a small, explicitly opted-in set of trusted `ARTICLE` sources -- through the bounded, deterministic auto-publication pass described in [Trusted-source auto-publication](#trusted-source-auto-publication-milestone-42b) below.

```text
approved RSS/Atom feed or manual URL
  -> bounded candidate metadata
  -> editor review/save/dismiss              -> editor-written CURATED draft -> CMS publication
     OR (trusted ARTICLE source only, M42B)  -> deterministic eligibility    -> auto-published CURATED article
```

## Approved sources and permissions

The registry supports `RSS`, `ATOM`, and `MANUAL_ONLY`. New sources default to `PAUSED`; activating a source does not fetch it. Only an admin can create/edit/disable/pause/resume definitions. Editors and admins can view sources, run a source test, and manually ingest active/error sources. No source is created or activated from an inferred team-site URL.

No default live source is inserted by the migration. Local RSS and Atom files under `src/modules/news-inbox/fixtures` are fictional test inputs, not publisher configurations. A live feed belongs in the registry only after its URL, publisher behavior, stability, content type, and usage constraints are documented.

The bounded August 2 evaluation found ESPN's NFL RSS technically parseable and rejected NFL.com's `?format=rss` HTML response; neither was inserted. See [the evaluation record](source-evaluations/news-feeds-2026-08-02.md).

The August 24 evaluation (Milestone 30A) added the first official-team feeds: nine `PAUSED` candidate sources across five clubs' News/Videos/Highlights RSS feeds. See [the evaluation record](source-evaluations/official-team-media-feeds-2026-08-24.md). Milestone 30B extended discovery to the remaining 27 clubs; see [that evaluation record](source-evaluations/official-nfl-team-feeds-2026-08-24.md). Milestone 30D activated the first cohort of official-team sources and added a bounded initial-ingest policy so a long-paused source's first activation can't flood the inbox; see [the activation record](news/official-team-source-activation.md) for the lookback/cap/late-item policy and its configuration.

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

## Content types and media metadata (Milestone 30A)

Every source declares a `contentType` (`ARTICLE`, `VIDEO`, or `HIGHLIGHT`) once, at creation — never inferred per item, never by AI. A feed URL is dedicated to one content type in practice (a club's News feed is `ARTICLE`, its Videos feed is `VIDEO`, its Highlights feed is `HIGHLIGHT`), so source configuration is the only classification mechanism, and it is copied onto every candidate the source produces. Legacy/text sources default to `ARTICLE` and are unaffected.

The parser additionally captures one media field, `thumbnailUrl`, from a feed's `media:content` or `<enclosure>` tag — but only when the tag's `type`/`medium` attribute indicates an image; a genuine video/audio enclosure is never captured as a thumbnail. Real official-team feeds evaluated for this milestone never expose a direct video file, an embed URL, or a duration — only a thumbnail image and a canonical page link — so no other media fields exist yet. Video/highlight downloading, rehosting, embedding beyond a feed-provided URL, or stream-manifest scraping are all out of scope; the canonical page URL is the only guaranteed way to reach the actual content, and that is by design (see the evaluation record above).

## Team suggestions

Suggestions use the configured default team, exact active full-team names, exact abbreviations, and the documented `WSH -> WAS` and `JAC -> JAX` aliases. City-only and fuzzy matching are deliberately absent. Suggestions are advisory and record their rule; candidate conversion accepts a separate editor-confirmed team-ID list.

A source flagged `isOfficialLeague` or `isOfficialTeam` is treated as strong NFL evidence on its own during quality evaluation, independent of team-suggestion matching — this is what lets an official-team feed skip the AI relevance classifier entirely, not a separate mechanism.

## Manual operations

HTTP operations are documented in OpenAPI under `/api/v1/admin/news-sources` and `/api/v1/admin/news-candidates`. Manual candidate submission validates and stores the supplied metadata but does not fetch the URL.

The CLI runs one source by default and requires an auditable active editor/admin account:

```sh
npm run news:ingest -- --source=nfl-news --actor=editor@example.com
```

`--all` processes at most 32 active non-manual sources sequentially. The bound covers the 23
production-active sources verified during Render Cron setup while still failing closed on an
unexpected mass activation.

Production ingestion is triggered by one Render Cron Job. Create it from the same backend
repository and production branch with this exact configuration:

- Service type: `Cron Job`
- Name: `2ndand15-news-ingestion`
- Branch: the production backend branch
- Schedule: `*/15 * * * *`
- Build command: `npm ci --include=dev && npm run build`
- Command: `npm run news:ingest:production -- --all --actor="$NEWS_INGESTION_ACTOR_EMAIL"`

Render evaluates cron schedules in UTC, but a run every 15 minutes is timezone-independent. Attach
the same Render Environment Group used by the backend Web Service/Worker where practical. The job
requires `NODE_ENV=production`, `DATABASE_URL`, and `NEWS_INGESTION_ACTOR_EMAIL`; the actor email
must resolve to an active persisted `EDITOR` or `ADMIN`. The three `NEWS_*` ingestion-policy values
and the five `NEWS_AUTO_PUBLISH_*` values are optional and retain their documented defaults when
omitted -- `NEWS_AUTO_PUBLISH_ENABLED` defaults `false`, so auto-publication stays off until an
operator explicitly sets it `true` in the Render environment. The auto-publish system account
(`NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL` in `news.service.ts`) must exist as an active `EDITOR`/`ADMIN`
row before the flag is ever turned on; the CLI fails closed with a clear error if it doesn't.

The production command uses the compiled `dist/commands/news-ingest.js` output and exits after its
bounded sequential pass. Render prevents overlapping executions of one Cron Job, while the
existing per-source database lease remains useful protection against a simultaneous manual/API
ingestion. Use Render's **Trigger Run** action for manual verification, then confirm
`NewsSource.lastCheckedAt` advances. No scheduler runs in GitHub Actions or inside the API process.
The job fetches feed metadata into private candidates and, for `--all` only, then runs one bounded
auto-publication pass over trusted `ARTICLE` sources (Milestone 42B, below) -- it never fetches
article pages. See [the activation record](news/official-team-source-activation.md) for the bounded
initial-ingest policy this CLI's real ingestion applies.

## Trusted-source auto-publication (Milestone 42B)

A small, explicit, ADMIN-only opt-in lets eligible `NewsCandidate` rows from specific trusted
`ARTICLE` sources become public `Article`s without an editor manually converting them. Activating a
source (`status: ACTIVE`) never implies this on its own -- `autoPublishArticles` is a second,
independent flag, and a global kill switch gates the feature everywhere regardless of any source's
flag.

### Rights-model conflict this milestone found

Human candidate conversion requires an editor-written original summary and explicitly rejects one
that copies the source description verbatim (`NEWS_CANDIDATE_SUMMARY_NOT_ORIGINAL`) -- there is no
human editor in the auto-publish path, and no AI is used to write one. The only rights-safe text
available is the source's own feed description, and current architecture only permits using it when
the source record already has `allowsDescriptionUse: true`. A source without this flag can never
auto-publish, full stop -- this is enforced as its own eligibility rule
(`SOURCE_DESCRIPTION_USE_NOT_ALLOWED`), not a workaround. An auto-published article's `body` is
always `null`: no commentary, no scraping, no generated text, ever. `Article.summary` is the source's
own description, unmodified, bounded to the column's 1,000-character width.

### Eligibility (deterministic, no AI)

**Source:** `status: ACTIVE`, `kind !== MANUAL_ONLY`, `contentType: ARTICLE`,
`autoPublishArticles: true`, `allowsDescriptionUse: true`.

**Candidate:** `status: NEW` and not already converted; non-empty headline; canonical URL is valid
HTTPS; `sourcePublishedAt` is present (never guessed) and within `NEWS_AUTO_PUBLISH_MAX_AGE_HOURS`
(publication time, not discovery time); `sourceDescription` is present and at least
`NEWS_AUTO_PUBLISH_MIN_DESCRIPTION_LENGTH` characters after trimming (default 40 -- backed by a real
evaluation of ESPN/PFT/CBS `NEW` candidates where 88/90 already cleared this bar). See
`src/modules/news-inbox/auto-publish-eligibility.ts`.

### What gets published

Reuses the existing `Article` model and the `CURATED` type -- no new content model. The transaction
(same one `convertCandidate` uses, given `publish: { status: 'PUBLISHED', publishedAt }`) creates the
article already `PUBLISHED` (not the `DRAFT` a human conversion produces, which still needs a
separate `publish()` action), links it 1:1 to the candidate, marks the candidate `CONVERTED`, and
writes an `AdminAuditEvent` with `action: 'NEWS_CANDIDATE_AUTO_PUBLISHED'` and
`reason: 'AUTO_PUBLISH'`, attributed to a dedicated system account
(`NEWS_AUTO_PUBLISH_SYSTEM_ACTOR_EMAIL`), never the human `NEWS_INGESTION_ACTOR_EMAIL` that runs the
CLI. Team associations come only from the candidate's existing deterministic suggestions
(`SOURCE_DEFAULT_TEAM`/`EXACT_FULL_NAME`/`EXACT_ABBREVIATION`); an unassociated story stays
league-wide. The public detail page's existing `sourceName`/`sourceUrl` attribution is the click-out
to the original publisher -- no separate syndicated-card mode was needed.

### Limits and the kill switch

| Variable                                   | Default | Bounds                                                                       |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| `NEWS_AUTO_PUBLISH_ENABLED`                | `false` | global kill switch -- `false` blocks every source regardless of its own flag |
| `NEWS_AUTO_PUBLISH_MAX_AGE_HOURS`          | `24`    | 1-72                                                                         |
| `NEWS_AUTO_PUBLISH_MAX_PER_RUN`            | `20`    | 1-100                                                                        |
| `NEWS_AUTO_PUBLISH_MAX_PER_SOURCE_PER_RUN` | `10`    | 1-100                                                                        |
| `NEWS_AUTO_PUBLISH_MIN_DESCRIPTION_LENGTH` | `40`    | 1-2000                                                                       |

One candidate's failure (e.g. a slug collision) is caught, logged on that item, and never aborts the
rest of the run or the source ingestion loop that preceded it -- the candidate stays `NEW` for retry
or manual review. `npm run news:auto-publish:preview` evaluates the exact same rules and caps against
the live database, including for a source not yet flagged trusted, and never writes anything --
useful before enabling a source's flag or the global switch, and unaffected by the global switch
being off. Disabling `autoPublishArticles` only stops future auto-publication; existing published
articles are ordinary CMS entities and are never auto-unpublished.

## Candidate conversion and rights

Conversion requires an editor-written title and original summary. A summary identical to the stored source description is rejected. Optional original commentary is safe Markdown limited to 2,000 characters. The source name, canonical URL, and publication timestamp seed editable attribution fields. Hero metadata is supplied independently by the editor; nothing is copied or downloaded from the feed.

The transaction creates a `CURATED` `DRAFT`, confirmed article-team joins, revision 1, the normal compact CMS audit, the terminal candidate relationship, and a compact candidate-conversion audit. Editors remain responsible for attribution, copyright, trademarks, publisher terms, and image rights before publication.

## Known limitations

RSS/Atom publishers vary in standards compliance, timestamps, GUID stability, redirects, and description practices. Malformed or unsafe feeds fail closed. There is no ordinary-page fallback, full-text extraction, image proxy, social/email ingestion, AI summary, alerting, recurring scheduling, or frontend inbox in this milestone. Automatic publication (Milestone 42B, above) exists only for a small, explicitly trusted set of `ARTICLE` sources, gated by a global kill switch defaulting off, and never for `VIDEO`/`HIGHLIGHT` content. Video/highlight candidates carry only metadata and a feed-provided thumbnail (Milestone 30A) — no video file is ever downloaded, rehosted, or proxied, and this remains true regardless of what a future feed's `<enclosure>` might contain.
