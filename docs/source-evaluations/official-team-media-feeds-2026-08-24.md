# Official team RSS/media-feed evaluation — August 24, 2026

This was a read-only evaluation followed by explicit `PAUSED` candidate-source
creation for feeds recommended `READY`. No feed body, thumbnail image, or
video was downloaded, rehosted, or persisted beyond the sanitized metadata
fields the news-inbox pipeline already stores (headline, canonical URL,
bounded description, publication time, and — new for this milestone — a
feed-provided thumbnail image URL). Every feed below was fetched twice: once
through the real, unmodified `SafeFeedClient` (SSRF/DNS/size/timeout
protections unchanged) and the M30A-extended `parseNewsFeed`, and once as a
raw inspection fetch to answer structural questions the normalized output
doesn't surface (e.g. presence of `<category>` tags). All ten feeds are
served by the same NFL "Wildcat" club-site platform (`static.nfl.com`,
`static.clubs.nfl.com`), so their structure is close to identical across
teams.

## Cross-feed findings (apply to all ten)

- All ten resolve directly — **no redirects, no moved URLs**. Every URL from
  the milestone brief worked as given.
- All ten are **RSS 2.0**, `content-type: application/rss+xml`, HTTP 200.
- Every item supplies: `<title>` (CDATA), `<description>` (CDATA, plain
  prose), `<link>`, `<pubDate>`, `<guid isPermaLink="false">` (a UUID), and a
  `<source url="...">` tag. `dc:creator`/`<author>` is **never** present —
  every candidate's `sourceAuthor` will be `null` for these sources.
- **No `<category>` tags anywhere.** Instead there's a non-standard
  `<media:keywords>` CDATA blob of comma-separated free-text tags. This is
  informational only; M30A does not capture it (content type is decided by
  source configuration, not by parsing keywords).
- **Media metadata is exactly one thing: a thumbnail image**, exposed
  redundantly through both `<media:content url="...">` (no `type`/`medium`
  attribute) and `<enclosure url="..." length="0" type="image/jpeg">`
  (always `image/jpeg`, `length` is always the literal string `"0"`, not a
  real byte count). **There is no direct video/audio file URL, no
  `media:player`, no `media:group`, and no duration field in any of the ten
  feeds.** The canonical `<link>` is the only way to reach the actual
  video/highlight content, and it is always a page on the team's own site
  (`/video/...`), never a raw media file. This is why M30A's schema only
  gained a single `mediaThumbnailUrl` column rather than the fuller
  enclosure/embed/duration shape originally sketched — the extra fields
  would never be populated by any of these ten real feeds.
- No feed exceeded the 100-entry parse cap except by having fewer real items
  than that (Arizona News: 20 items; Baltimore Videos: 5 items — both
  genuinely smaller feeds, not truncation).
- Within every single feed, `<guid>` count, unique `<guid>` count, and unique
  `<link>` count were all equal — **zero duplicate IDs or links within any
  one feed** during this sample.

## Arizona Cardinals News

- Feed URL: `https://www.azcardinals.com/rss/news` — resolves directly, no redirect
- Publisher: Arizona Cardinals
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 22,830 bytes; 20 entries (feed is smaller than the 100-cap)
- IDs: 20/20 distinct GUIDs (UUID form)
- Links: 20/20 distinct `azcardinals.com/news/...` URLs
- Descriptions: plain-text, e.g. 69 chars in the sampled item; no HTML tags
- Dates: all supplied `pubDate`; newest observed `2026-08-24T20:26:13Z`
- Media metadata: 20/20 items have a thumbnail (`media:content`/`enclosure`, always `image/jpeg`); no video/embed URL present
- Team association: source-configured (`defaultTeamId` = ARI, `isOfficialTeam` = true) — no per-item classification needed or attempted
- **Recommendation: `READY`**

## Arizona Cardinals Videos

- Feed URL: `https://www.azcardinals.com/rss/videos` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 113,291 bytes; 100 entries (cap reached — more exist)
- IDs/Links: 100/100 distinct GUIDs and links
- Media metadata: 100/100 items have a thumbnail; canonical link is the video page (`/video/...`); no direct media file URL
- Content type: source-configured `VIDEO`
- **Recommendation: `READY_WITH_LIMITATIONS`** — canonical page URL only, no direct/embed media URL, per the brief's own allowance that this is sufficient

## Baltimore Ravens News

- Feed URL: `https://www.baltimoreravens.com/rss/news` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 118,683 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: 100/100 items have a thumbnail
- **Recommendation: `READY`**

## Baltimore Ravens Videos

- Feed URL: `https://www.baltimoreravens.com/rss/videos` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 6,439 bytes; 5 entries (genuinely small feed today)
- IDs/Links: 5/5 distinct
- Media metadata: 5/5 items have a thumbnail; canonical link is the video page
- Content type: source-configured `VIDEO`
- **Recommendation: `READY_WITH_LIMITATIONS`** (same reasoning as Arizona Videos; also flagged for low current volume — worth re-checking item count after the season starts)

## Carolina Panthers News

- Feed URL: `https://www.panthers.com/rss/news` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 117,671 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: 100/100 items have a thumbnail
- **Recommendation: `READY`**

## Carolina Panthers Videos

- Feed URL: `https://www.panthers.com/rss/videos` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 120,329 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: 100/100 items have a thumbnail; canonical link is the video page
- Content type: source-configured `VIDEO`
- **Recommendation: `READY_WITH_LIMITATIONS`**

## Green Bay Packers News

- Feed URL: `https://www.packers.com/rss/news` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 104,104 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: **99/100 items have a thumbnail** — the one real-world exception found in this evaluation, confirming the parser's "no media metadata present" path (`thumbnailUrl: null`) is exercised by genuine production data, not just synthetic fixtures
- **Recommendation: `READY`**

## Green Bay Packers Videos

- Feed URL: `https://www.packers.com/rss/videos` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 112,708 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: 100/100 items have a thumbnail; canonical link is the video page
- Content type: source-configured `VIDEO`
- **Recommendation: `READY_WITH_LIMITATIONS`**

## Chicago Bears Highlights

- Feed URL: `https://www.chicagobears.com/rss/highlights` — resolves directly
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 110,467 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Descriptions: every sampled headline is prefixed `HIGHLIGHT: ...` (e.g. _"HIGHLIGHT: Skyler Thomas' INT comes via full-extension snag"_) — a strong human-readable signal, but content type is still set by source configuration (`HIGHLIGHT`), not by parsing the title text
- Media metadata: 100/100 items have a thumbnail; canonical link is the highlight/video page (`/video/...`); no direct media file, no duration
- **This is the milestone's HIGHLIGHT regression fixture source.** Every item genuinely represents one discrete highlight/video page — there is nothing in the feed distinguishing a "highlight" structurally from a "video" item on the Videos feed of any other team; the categorization is entirely which feed URL it came from
- **Recommendation: `READY_WITH_LIMITATIONS`** (same media-metadata limitation as the other video feeds)

## Chicago Bears News

- The brief only hard-coded the Highlights feed for Chicago and asked for the
  official RSS directory to be inspected for a current news feed. Fetching
  `https://www.chicagobears.com/rss/` returned an HTML directory page (not a
  feed) listing 37 category feeds, including a plain, general
  `https://www.chicagobears.com/rss/news` — structurally identical to every
  other team's News feed (not a narrower editorial column like
  `chalk_talk`/`inside_the_locker_room`/etc., which the directory also
  lists but which are not "clearly current, general news").
- Feed URL: `https://www.chicagobears.com/rss/news` (discovered, not guessed)
- Format/status/type: RSS 2.0; HTTP 200; `application/rss+xml`
- Response/entries: 115,568 bytes; 100 entries
- IDs/Links: 100/100 distinct
- Media metadata: 100/100 items have a thumbnail
- **Recommendation: `READY`**

## Model/parser changes this evaluation justified

- Added `NewsContentType` (`ARTICLE | VIDEO | HIGHLIGHT`) on `NewsSource`
  (set once, at creation) and copied onto every `NewsCandidate` it produces.
  No per-item AI or keyword classification — confirmed unnecessary by every
  feed above, since content type is determined entirely by which feed URL a
  source is configured with.
- Added exactly one new `NewsCandidate` column, `mediaThumbnailUrl`, backed
  by a small, generic (not team-specific) parser extension that reads the
  `url` attribute off `<media:content>` or `<enclosure>`, rejecting any
  enclosure whose `type`/`medium` attribute indicates it is not an image.
  `mediaUrl`, `mediaEmbedUrl`, `mediaMimeType`, and `durationSeconds` — all
  present in the milestone's illustrative schema — were **not** added, per
  "do not add fields no source actually provides": none of the ten real
  feeds ever populate a direct media file, an embed URL, or a duration.

## Candidate sources created (all `PAUSED`, none enabled)

All nine `READY`/`READY_WITH_LIMITATIONS` feeds above were created as
disabled candidate `NewsSource` rows through the real
`POST /api/v1/admin/news-sources` service path (`isOfficialTeam: true`, each
with its matching `defaultTeamId`, `status: 'PAUSED'`). `SourceRightsProfile`
was deliberately left unset for all nine — consistent with the existing
policy (`docs/editorial-ai/source-rights.md`) that official-team/publisher
status is never itself treated as proof of reuse rights, mirroring how
ESPN's own profile was left `UNKNOWN`/`reviewRequired: true` even after a
"technically suitable" evaluation. A human reviewer must set text/image/video
usage and quotation policy before any converted-article rights-gated
behavior (e.g. sending descriptions to AI drafting) can apply to these
sources. See the completion report for exact source IDs/slugs and the
bounded dry-run (`test`) results run against each.
