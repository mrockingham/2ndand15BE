# Official-team source activation (Milestone 30D)

M30A-M30C discovered, evaluated, and created 61 candidate `NewsSource` rows (60
official-team, 1 legacy ESPN) and built the editorial candidate/publication
pipeline and public presentation for `ARTICLE`/`VIDEO`/`HIGHLIGHT` content. All 60
official-team sources were deliberately left `PAUSED`. This milestone activates
the first small cohort in production and hardens ingestion so that flipping a
long-paused source to `ACTIVE` cannot flood the News Inbox with historical
content or duplicate work.

Activating a source means "poll this RSS feed into editorial candidates." It does
not mean "2nd & 15 has unrestricted republishing rights," and it does not mean
"auto-publish this club's content." Every candidate this pipeline creates still
enters the existing `NEW` review state and requires a human editor to save,
write original commentary, and convert it before anything becomes a public
article. `SourceRightsProfile` remains `UNKNOWN`/`reviewRequired: true` for every
official-team source; activation status and rights status are independent.

## Architecture reused unchanged

Per the M30D research pass, the existing ingestion architecture already covered
almost everything this milestone needed:

- **Source status/scheduling**: `NewsSource.status` (`PAUSED`/`ACTIVE`/`ERROR`/`DISABLED`),
  `pauseSource`/`resumeSource` on `NewsInboxService`, both audited
  (`NEWS_SOURCE_PAUSED`/`NEWS_SOURCE_RESUMED`).
- **Ingestion entry points**: `NewsInboxService.testSource()` (bounded dry run,
  never writes) and `.ingestSource()` (real, audited, leased). Both already
  existed and needed no new HTTP routes or CLI flags.
- **Concurrency control**: a single ingestion lease per source
  (`acquireIngestionLease`/`completeIngestion`), stale-recoverable after 15
  minutes, already prevents overlapping runs of the *same* source. Multiple
  *different* sources are processed strictly sequentially by the CLI's `for`
  loop (see Cadence and concurrency below) -- no new concurrency primitive was
  needed.
- **Deduplication and feed-item identity**: `upsertFeedCandidate`'s existing
  priority (stable `sourceExternalId`, then global `canonicalUrlHash`) is
  unchanged and is what makes a second ingestion pass a no-op.
- **Candidate states**: candidates still land in `NEW` and follow the existing
  `NEW -> REVIEWING | SAVED | DISMISSED | CONVERTED` machine. Nothing in this
  milestone auto-transitions a candidate.
- **Source health fields**: `lastCheckedAt`, `lastSuccessfulAt`, `lastErrorCode/Summary`,
  `lastItemCount`, `consecutiveFailureCount` already existed on `NewsSource` and
  are reused as-is for admin visibility; no schema addition was needed for them.

No new scheduler, queue, or background worker was introduced -- `docs/news-source-ingestion.md`
already documents that choice deliberately, and this milestone did not revisit
it (see Cadence and concurrency below).

## What's actually new: the bounded initial-ingest policy

The one real gap: nothing previously stopped a source's first-ever ingest from
importing every item a feed returns (up to the parser's 100-entry cap), all at
once, the moment a source is activated. `src/modules/news-inbox/initial-ingest-policy.ts`
adds two small, pure, independently unit-tested pieces of policy, both wired
into `NewsInboxService`'s private `runSource()`:

1. **Bounded initial ingest** (`classifyInitialIngestEntries`) -- applies only
   to a source's first real ingest. An entry is accepted only if it has a
   parsed `publishedAt` **and** that date falls within
   `NEWS_INITIAL_INGEST_LOOKBACK_HOURS` (default **72**) of now. Accepted
   entries are then sorted newest-first and capped to
   `NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE` (default **25**) per source per
   run. Everything excluded is categorized, not silently dropped: outside the
   lookback window, missing a usable publication date, or truncated by the
   cap. An item with no publication date is **never** imported during this
   one-time window -- the milestone brief was explicit that blind import on
   first activation is unacceptable, and a feed's own fetch time is never
   substituted as a guess.
2. **Steady-state late/out-of-order guard** (`isLateOutOfOrderEntry`) --
   applies to every ingest *after* the first. It compares each entry's
   `publishedAt` against a **watermark**: the newest `sourcePublishedAt` this
   source has ever actually persisted (`MAX(NewsCandidate.sourcePublishedAt)
   WHERE sourceId = ...`, one aggregate query -- no new column). An entry more
   than `NEWS_LATE_ITEM_TOLERANCE_HOURS` (default **48**) behind the
   watermark is only rejected if it is genuinely new (never seen before, by
   the same external-ID/canonical-URL identity `upsertFeedCandidate` already
   uses); an already-known item always continues to update normally
   regardless of its date. This is what stops a feed that reorders itself
   from suddenly backfilling an old article into today's inbox, while still
   letting a source catch up on items the initial cap deliberately deferred
   (see the worked example below).

### What counts as "initial"

A source's ingest is "initial" exactly when **it has never written a real
`NewsCandidate` row** (`NewsInboxRepository.hasAnyCandidates`). This is
deliberately **not** `NewsSource.lastSuccessfulAt`, even though that field
looks like the obvious durable signal and was the first design tried here.
`lastSuccessfulAt` is set by `completeIngestion` on *any* non-failed run --
including a `testSource()` dry run, which writes nothing. M30A's own
evaluation explicitly ran a bounded dry-run test against every one of the 10
Wave 1 sources before this milestone began, which had already set
`lastSuccessfulAt` on all of them despite zero real candidates existing. Using
that field as the initial-ingest signal would have (and, in an early version
of this milestone's rollout, briefly did -- see Incident below) treated every
Wave 1 source's true first real ingest as if it were already initialized,
skipping the bounded window entirely. Keying off actual candidate existence
instead is unaffected by dry runs and is still existing, restart-safe,
durable state -- no new schema column was added.

### Configuration

Three environment variables, all optional with the defaults above, validated
by the existing Zod environment schema alongside every other subsystem's
config (`src/config/env.ts`):

```
NEWS_INITIAL_INGEST_LOOKBACK_HOURS=72
NEWS_INITIAL_INGEST_MAX_ITEMS_PER_SOURCE=25
NEWS_LATE_ITEM_TOLERANCE_HOURS=48
```

`loadNewsIngestionConfig()` (narrow, database-config-sized, for the CLI) and
the main `loadConfig()` (for the HTTP server) both expose these under a
`newsIngestion` object, matching the existing per-subsystem config pattern
(`loadSportsSyncConfig`, `loadCurrentGameSyncConfig`, etc.). `NewsInboxService`
takes this as an optional constructor argument defaulting to the same values,
so existing call sites and tests are unaffected unless they care.

### A worked example (real Wave 1 data)

Green Bay Packers Videos, on its true first real ingest: the feed returned 100
items, 8 of which had a `publishedAt` within the last 72 hours. All 8 were
created (`wouldCreate` matched `created` exactly in the dry run and the real
run). The other 92 were outside the lookback and skipped. On the **next**
ingest cycle, those 92 are not blindly imported just because the cap lifted --
each one is now evaluated against the watermark (the newest of the 8 already
ingested) plus the 48-hour tolerance, and the large majority remain older than
that tolerance and are correctly rejected as `lateRejected`, not created. Only
a genuinely new, recent item -- or one within 48 hours of the current
watermark -- gets created going forward. This is the intended shape: a bounded
first wave, then a purely forward-moving, self-dedup steady state.

## Incident during this milestone: initial detection bug and remediation

While activating Wave 1 for real, the first attempt used
`lastSuccessfulAt === null` as the initial-ingest signal (the design described
above as "the first design tried"). Because all 10 Wave 1 sources had already
been dry-run tested during M30A's own evaluation, every one of them already
had `lastSuccessfulAt` set, so `isInitialIngest` evaluated to `false` on their
true first real ingest and the bounded lookback/cap never engaged. The first
real activation run created **725 unbounded candidates** across 9 of the 10
sources (Arizona Cardinals News: 20, Videos: 100; Baltimore Ravens News: 100,
Videos: 5; Carolina Panthers News: 100, Videos: 100; Chicago Bears News: 100;
Green Bay Packers News: 100, Videos: 100). The 10th source, Chicago Bears
Highlights, already had 100 pre-existing candidates from earlier work (dated
the day before this run, including one already `CONVERTED` to a published
article) and was completely untouched by the bug (0 created, 100 skipped as
unchanged) -- confirmed by inspecting every affected candidate's
`discoveredAt` timestamp before touching anything.

Remediation, in order: (1) identified the exact 725 rows via `discoveredAt`
falling on the run's date for the 9 affected sources, explicitly verifying
zero rows predated the run before deleting anything; (2) deleted exactly those
725 rows, source by source, leaving Chicago Bears Highlights' 100 pre-existing
rows untouched; (3) cleared the 9 sources' cached `responseEtag`/`responseModified`
conditional-request validators so the redo would not risk a `304 Not Modified`
short-circuit against an unchanged remote feed; (4) fixed `isInitialIngest` to
key off real candidate existence instead of `lastSuccessfulAt` (see above);
(5) re-ran real ingestion for all 10 Wave 1 sources. The corrected run produced
exactly the bounded counts the pre-activation dry run had predicted (62 new
candidates across 9 sources, 0 for Carolina Panthers Videos whose entire feed
was outside the lookback at that moment, Chicago Bears Highlights' 100 still
untouched), and a second pass immediately after created 0 new candidates. No
public-facing article was affected at any point -- the published article count
was 3 before, during, and after this entire incident.

## Wave 1

Wave 1 activated the five teams that already had proven, real-world-validated
feeds from M30A: Arizona Cardinals, Baltimore Ravens, Carolina Panthers,
Chicago Bears, Green Bay Packers -- 10 sources total (9 `ARTICLE`/`VIDEO` pairs
plus Chicago's dedicated `HIGHLIGHT` source in place of a Videos source, per
that team's actual feed shape from M30A). No other team's sources were
touched; all remaining 50 official-team sources from M30B stay `PAUSED`.

Activation went through the normal audited path only:
`NewsInboxService.resumeSource()` for status transition
(`NEWS_SOURCE_RESUMED` audit event, actor-attributed), then
`NewsInboxService.ingestSource()` for the real fetch. No raw database writes
were used for source status or candidate content. (The remediation above
deleted erroneously-created candidate rows and cleared two cache-validator
columns directly -- not source configuration or candidate content -- because
there is no service method for undoing an ingest's writes; this is documented
here rather than hidden.)

## Cadence and concurrency

No in-process scheduler exists and none was added -- `docs/news-source-ingestion.md`'s
existing "no cron, recurring scheduler, background worker, queue, webhook, or
continuous process" statement still holds. The existing `npm run news:ingest --
--all --actor=<email>` CLI (or `--source=<slug>` for one source) remains the
only ingestion trigger, intended to be invoked by an external, ordinary
scheduler (OS cron, a hosting platform's scheduled task, etc.) on a
**15-30 minute cadence** -- RSS feeds do not need minute-by-minute freshness,
and every source's own health fields (`lastCheckedAt`, `lastSuccessfulAt`)
make it easy to notice if that external trigger stops running. The CLI already
processes sources strictly one at a time in a sequential loop -- an inherently
bounded concurrency of 1, well within the "modest, 4-8 at most" guidance, and
simpler than adding a batching primitive that isn't needed at today's source
count. The original milestone raised `--all`'s bound from 5 to **20** for Wave
1. Render Cron setup later raised `MAXIMUM_BULK_SOURCES` to **32** after a
read-only production check found 23 active sources. That covers the reviewed
active registry with headroom while still failing closed on an unexpected mass
activation rather than turning `--all` into an unbounded sweep.

## Operational rollback

If an active source turns out to be noisy or broken:

1. **Pause it** through the normal audited path -- `POST
   /api/v1/admin/news-sources/{id}/pause` or `NewsInboxService.pauseSource()`.
   This immediately stops future ingestion; `ingestSource` refuses to run
   against a non-`ACTIVE`/`ERROR` source.
2. **Do nothing else automatically.** Already-created candidates and their
   audit trail are preserved -- pausing a source is not a reason to delete
   editorial work in progress.
3. **Review through the normal candidate workflow.** An editor dismisses
   individual candidates (with a required reason) via the existing
   `NEW/REVIEWING/SAVED -> DISMISSED` transition if specific items shouldn't
   be pursued. Bulk-deleting candidate content is not part of this procedure.
4. Resume only after the underlying feed issue is understood (matching the
   already-documented `ERROR` -> `ACTIVE` recovery: `ingestSource` accepts
   both `ACTIVE` and `ERROR` sources, and a subsequent success automatically
   clears `ERROR` back to `ACTIVE`).

This is distinct from the one-time remediation described above, which was
cleaning up a genuine implementation bug's output before any editor ever saw
it -- not a response to a noisy production feed.

## Known, deliberately unaddressed limitations (unchanged from M30B)

- Washington Commanders' `ARTICLE` feed remains `NOT_READY` (stale, unsorted).
- Cincinnati Bengals', Dallas Cowboys', and Houston Texans' `VIDEO` feeds
  remain unusable (wrong content / empty response).
- Chicago Bears remains the only club with a dedicated `HIGHLIGHT` feed.

No webpage-scraping fallback was built for any of these in this milestone.
