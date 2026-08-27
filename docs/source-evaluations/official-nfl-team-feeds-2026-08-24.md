# Official NFL team RSS/media-feed evaluation — Milestone 30B (August 24, 2026)

M30A (see `official-team-media-feeds-2026-08-24.md`) validated the news-inbox
pipeline against 5 clubs (Cardinals, Ravens, Panthers, Bears, Packers) and
shipped `NewsContentType` + `mediaThumbnailUrl`. This milestone extends
coverage to the remaining 27 NFL clubs using the same architecture,
unmodified: no new parser, no new schema, no AI classification. Content type
is still decided entirely by which feed URL a source is configured with.

This was research + real (`PAUSED`) candidate-source creation, nothing more.
Discovery was live web fetching against each club's own domain only — no
third-party RSS directories, aggregators, or scraped social feeds. Every feed
below was fetched and its bounded sample (whatever the feed naturally
returned, no crawling beyond that) was inspected before any source record was
created. No video, audio, or image file was downloaded, rehosted, or
persisted — only the same sanitized metadata fields M30A already stores
(headline, canonical URL, bounded description, publication time, thumbnail
URL).

## Discovery-method note

M30A's report used prose, not a formal enum, to describe how each feed was
found. This milestone adopts two explicit labels for that same idea:

- **OFFICIALLY_LINKED** — the feed URL was read directly off the club's own
  `/rss/` directory listing page.
- **DISCOVERED_VALID_ENDPOINT** — the club's `/rss/` directory page did not
  resolve, so the known Wildcat-platform pattern (`/rss/news`, `/rss/videos`,
  `/rss/highlights`) was tested directly. Accepted only when the endpoint
  resolved as genuine RSS/Atom XML, belonged to the real official domain, and
  its sampled content was clearly about that team — never on HTTP 200 alone.

**Of the 27 teams evaluated, only the Denver Broncos expose a working `/rss/`
directory page today** (it even carries an explicit reuse/attribution notice:
_"DenverBroncos.com is now offering the following feeds in the RSS format...
provided free of charge for use by individuals and non-profit
organizations... attribution to DenverBroncos.com required"_). All other 26
teams' directory pages returned HTTP 404. As a spot-check, one research pass
also re-tested `https://www.azcardinals.com/rss/` — an M30A-validated
team — and it, too, now 404s. This suggests the directory-listing page is not
reliably present across the platform (or has changed since M30A), not that
the guessed-path pattern itself is any less trustworthy; every
`DISCOVERED_VALID_ENDPOINT` feed below was still validated by real content,
not by status code alone. The existing 5 M30A sources were left untouched —
this is an observation for future discovery work, not a reason to touch them.

## Cross-team findings (apply broadly across the 27)

- Every working feed is RSS 2.0 on the same NFL "Wildcat" platform fingerprint
  as M30A: `xmlns:media` (Yahoo MRSS), UUID `<guid isPermaLink="false">`,
  `<media:content>` + `<enclosure type="image/jpeg">` thumbnail pairs, no
  `<category>` element (taxonomy instead lives in a `<media:keywords>` CDATA
  blob), no `<author>`/`dc:creator` anywhere. This matches M30A exactly and
  required no parser changes.
- Feed depth (item count in the bounded sample) varies a lot by team and is
  **not** a quality signal by itself — e.g. Steelers News/Videos (12 items
  each) and Patriots News (5 items) are just as fresh and well-formed as
  Colts/Giants/Eagles (100+ items); smaller feeds simply have a narrower
  natural rolling window.
- `/rss/highlights` is confirmed **Chicago-only**. All 27 teams here return a
  clean 404 for it. Steelers and Seahawks fold highlight-titled clips
  directly into their Videos feed (`"HIGHLIGHT: ..."` / `"...Game
  Highlights..."` items) instead of a separate endpoint; several other teams'
  Videos feeds contain similar highlight-style items mixed in. No team
  justified a dedicated `HIGHLIGHT` source this round.
- Zero duplicate GUIDs and zero duplicate canonical links were found within
  any single feed across all 27 teams.
- Every News/Videos feed pair that both resolved was structurally distinct
  (news = article pages, videos = video pages) with no meaningful item-level
  overlap observed — no team in this batch needed a "keep only one of
  these" dedup decision the way generic-Videos-vs-Highlights might elsewhere.

## Per-team results

Legend: **A** = ARTICLE (News), **V** = VIDEO, **H** = HIGHLIGHT. Discovery:
**OL** = OFFICIALLY_LINKED, **DV** = DISCOVERED_VALID_ENDPOINT.

| Team | News feed | Video feed | Highlight | Discovery | Fresh? | Candidate created? |
|---|---|---|---|---|---|---|
| Atlanta Falcons | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Buffalo Bills | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Cincinnati Bengals | READY | **NOT_READY** (wrong-content, stale) | none | DV | news yes / video no | A only |
| Cleveland Browns | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Dallas Cowboys | READY_WITH_LIMITATIONS (1 bad pubDate) | **NOT_READY** (200/empty body) | none | DV | news yes / video no | A only |
| Denver Broncos | READY | READY_WITH_LIMITATIONS | none | **OL** | yes | A + V |
| Detroit Lions | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Houston Texans | READY | **NOT_READY** (200/empty body) | none | DV | news yes / video no | A only |
| Indianapolis Colts | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Jacksonville Jaguars | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Kansas City Chiefs | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Las Vegas Raiders | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Los Angeles Chargers | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Los Angeles Rams | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Miami Dolphins | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Minnesota Vikings | READY (description gap noted) | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| New England Patriots | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| New Orleans Saints | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| New York Giants | READY (mixed news/video/photo links) | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| New York Jets | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Philadelphia Eagles | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Pittsburgh Steelers | READY (shallow, 12 items) | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| San Francisco 49ers | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Seattle Seahawks | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Tampa Bay Buccaneers | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Tennessee Titans | READY | READY_WITH_LIMITATIONS | none | DV | yes | A + V |
| Washington Commanders | **NOT_READY** (stale/unsorted, spans 2022-2026) | READY_WITH_LIMITATIONS | none | DV | news no / video yes | V only |

## Notable per-team detail (anomalies and limitations)

### Cincinnati Bengals — Videos feed is the wrong feed, not just stale
`https://www.bengals.com/rss/videos` resolves (HTTP 200, valid RSS) but its
channel title/description is literally **"Bengals Weekly"** — a
show/podcast feed, not the general team-video feed the URL pattern implies.
Its newest item is over 7 months old (Jan 2026), even though
`https://www.bengals.com/video/` itself renders current, daily video content
in the browser. That page exposes no `<link rel="alternate"
type="application/rss+xml">`, so no general video RSS could be located for
this team. **No Bengals video source was created.** Fallback reference (plain
webpage, not RSS): `https://www.bengals.com/video/`.

### Dallas Cowboys — Videos feed returns HTTP 200 with a zero-byte body
Confirmed twice via direct fetch with header inspection
(`Content-Length: 0`), not a transient blip or fetch-tool artifact — distinct
from the clean 404s every other unavailable feed in this milestone returned.
**No Cowboys video source was created.** Fallback:
`https://www.dallascowboys.com/all-media/index` (plain webpage, no RSS
autodiscovery link present). The Dallas **News** feed is otherwise clean
except one pinned recurring-column item ("Strong Side") that carries an
anomalous `pubDate` of May 2018 while sitting first in the feed; items 2-100
are correctly dated August 2026. This is a content quirk on the source's end,
not a parser bug — `parseNewsFeed` already stores whatever `pubDate` a feed
supplies without reinterpreting it, exactly as designed. Flagged here for
editorial awareness, not a code change.

### Houston Texans — same "200 but empty" failure mode as Dallas
`https://www.houstontexans.com/rss/videos` returns HTTP 200 with an empty
body on two separate fetches. **No Texans video source was created.**
Fallback: `https://www.houstontexans.com/video/` ("Texans Watch", plain
webpage). Texans News is clean and READY.

### Washington Commanders — News feed is stale and unsorted, not just old
`https://www.commanders.com/rss/news` returns well-formed RSS 2.0 with unique
GUIDs and real Commanders canonical links, but items are **not in
reverse-chronological order and span February 2022 through June 2026 mixed
together with no discernible pattern.** The newest item is ~67 days old as of
this evaluation, despite the live `https://www.commanders.com/news/index`
webpage showing same-day training-camp articles absent from the feed. This
reads as a stale/misconfigured "evergreen" feed rather than the live
firehose the same path serves for every other club. **No Commanders news
source was created.** Fallback: `https://www.commanders.com/news/index`
(plain webpage). The Commanders **Videos** feed, on the same domain and
platform instance, is completely fine (fresh, 2 days old at evaluation time)
and was created normally — recommend a manual re-check of the News endpoint
closer to kickoff rather than writing it off permanently.

### Minor field-completeness notes (informational only, no parser change)
- **Minnesota Vikings** News: `<description>` is present on only the newest
  of 8 sampled items; title/link/pubDate/guid/thumbnail are consistently
  present regardless. This exercises the same "no description present" path
  the parser and Green Bay's 99/100 case from M30A already cover — no new
  test needed.
- **New York Giants** News: the feed is a mixed content stream — items link
  to `/news/`, `/video/`, and `/photos/` pages, not exclusively article
  pages. Content type is still set deterministically by source configuration
  (`ARTICLE`, since it's the News-labeled feed), per the milestone's
  "document ambiguity, choose the safest deterministic classification" rule.
- **Tennessee Titans**: NFL.com's own team-page link points to the legacy
  `titansonline.com`, which 302-redirects to `tennesseetitans.com`. The
  canonical/live domain (`tennesseetitans.com`) is what was used for both
  feed URLs and `siteUrl`.

## Cross-feed deduplication

Every team with both a working News and Videos feed has structurally
disjoint content (News → `/news/...` article pages, Videos → `/video/...`
pages) — there is no generic-Videos-vs-Highlights overlap question to answer
for any of the 27 teams, since none of them run a separate Highlights feed.
This matches the M30A finding that only Chicago's Highlights feed exists at
all, and it remains the only HIGHLIGHT-classified source in the system.

## Specialized feeds noticed, not added

Six teams (Atlanta, Buffalo, Cincinnati, Cleveland, Dallas, Denver) were
spot-checked for `/rss/audio` and `/rss/galleries` — both resolved live
(HTTP 200, non-trivial body) wherever tested. Denver's directory page
additionally confirmed these as the platform's only other public feed
categories (**Audio**, **Photos**) alongside News and Videos — no
roster-moves/transactions/press-conference/mic'd-up feeds are exposed as
separate endpoints on any team checked. These were not evaluated in depth or
turned into candidates this milestone, per the "good coverage, not maximum
feed count" instruction. **Recommendation:** worth a dedicated, narrowly
scoped future evaluation if audio or photo-gallery ingestion becomes a
product priority — likely follows the exact same discovery/validation
pattern as News/Videos, just untested here.

Several Videos feeds (Colts, Chiefs) skew heavily toward press-conference and
"mic'd up" content rather than game action — this is existing content inside
the generic Videos feed, not a reason to split it into a separate source.

## Model/parser changes this evaluation required

**None.** Every one of the 50 new candidate sources parses through the
existing, unmodified `parseNewsFeed`/`SafeFeedClient`/`NewsInboxService`
pipeline built for M30A. No new RSS namespace, no new field, no team-specific
scraping was needed. This confirms M30A's architecture generalizes across the
full 32-team league, not just the 5-team pilot cohort.

## Candidate sources created (all `PAUSED`, none enabled)

All 50 `READY`/`READY_WITH_LIMITATIONS` feeds identified above were created
as disabled candidate `NewsSource` rows through the real, unmodified
`NewsInboxService.createSource()` path (the same audited service the real
`POST /api/v1/admin/news-sources` route calls) — `kind: 'RSS'`,
`isOfficialTeam: true`, `isOfficialLeague: false`, matching `contentType`,
matching `defaultTeamId`, `status: 'PAUSED'`. Every source was additionally
exercised once through `NewsInboxService.testSource()` (the same bounded,
no-write dry-run the admin "Test" action performs) immediately after
creation, and every one of the 50 returned `SUCCEEDED` with a non-zero
`fetchedCount` — confirming each is genuinely fetchable and parseable, not
just DNS-reachable. `SourceRightsProfile` was deliberately left unset
(`UNKNOWN`) for all 50, consistent with M30A policy — official-team status is
never itself treated as proof of reuse rights.

26 teams received an ARTICLE (News) source; 24 received a VIDEO source; 0
received a HIGHLIGHT source (none exists to add). Washington received only a
VIDEO source (its News feed is `NOT_READY`); Cincinnati, Dallas, and Houston
each received only an ARTICLE source (their Video feeds are `NOT_READY`).

Combined with the 11 pre-existing sources from M30A (5 teams: ARI, BAL, CAR,
GB, CHI, plus the legacy ESPN source), the database now holds **61 total
`NewsSource` rows**, verified via `NewsInboxRepository.listSources()`
(the same query the admin listing endpoint uses): 60 `PAUSED` + 1 `ACTIVE`
(ESPN), 31 `ARTICLE` + 28 `VIDEO` + 1 `HIGHLIGHT`, 60 with `isOfficialTeam:
true` and a `defaultTeamId` set. Filtering by `status`/`kind`/`contentType`
via the existing `newsSourceListQuerySchema` was confirmed to return the
expected counts. There is no `teamId`/`isOfficialTeam` filter on the list
endpoint today (the repository's `listSources` where-clause only conditions
on `status`/`kind`/`contentType`) — this is a pre-existing gap from M30A, not
introduced here, and was left alone rather than expanded, consistent with
this milestone's "reuse the existing service, no unrelated changes" scope.
A team-scoped browse view would be straightforward to add later if the admin
UI needs it once 32 teams' worth of sources are live.
