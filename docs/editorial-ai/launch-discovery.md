# Launch candidate discovery

Launch discovery reuses the existing SSRF-resistant, byte/time/redirect/depth/entry-bounded RSS/Atom inbox. It does not crawl pages, fetch article bodies or images, infer 32 team feed URLs, or add an unreviewed paid/search provider.

`POST /api/v1/admin/editorial/discover-launch-candidates` accepts `targetPerTeam` (1-20, default 10), `freshnessDays` (1-30, default 14), `maxNewCandidates` (1-320), and `pilot`. It never generates or publishes articles.

Active configured sources are ordered by four admin-configurable 0-100 preference inputs: reliability, metadata richness, team specificity, and editorial usefulness. New sources retain conservative unknown rights. Preference affects request order and scoring, not factual truth or permission.

The coordinator calculates each team's gap from published/scheduled/draft articles plus evaluated useful candidates, prioritizes the largest gaps, and uses the internal 32-team catalog. Pilot mode dynamically chooses one team with existing opportunity coverage and three with zero. A feed is requested once per operation, not once per team; normalized feed entries are URL/external-ID deduplicated and existing deterministic team suggestions provide team scope.

Ingestion writes are capped per source and globally. Sources run sequentially; a provider/rate failure stops further requests without aggressive retries. Fresh candidates for attempted teams are evaluated in batches of at most 50. Rejected and duplicate rows do not count toward useful coverage. The response reports raw, created, updated, deduplicated, NFL-relevant, useful, source-diversity, quality, failure, and stop counts.

The existing ESPN NFL RSS source is currently the only hosted source. It is a league-wide feed rather than a query/search source, which explains the sparse and uneven 22-candidate inventory. Google News RSS has not been activated because no reviewed application configuration or rights/usage decision exists; Bing/documented news APIs require separate configuration or commercial review. Full 32-team discovery must stop if the four-team pilot does not safely produce useful new inventory.

No YouTube request is part of discovery. Media search terms remain an article-draft output, and no media is downloaded, rehosted, or automatically attached.

## Hosted source inventory and pilot — August 9, 2026

The only active source is `ESPN NFL News`, an RSS league feed. It has 31 candidates after the pilot, successful current health, 21 entries in its latest response, and no consecutive failures. Every stored entry has a description averaging 21.9 words, but the conservative rights profile remains text/image/video/quotation `UNKNOWN` with `reviewRequired=true`; descriptions therefore do not contribute to generation sufficiency. The feed exposes no stored image or video reference fields.

The dynamic pilot selected BUF (one existing opportunity) plus zero-coverage ARI, ATL, and BAL. One approved source request returned 21 raw entries. The bounded write created nine, updated one, and did not create an article or publication. None of the nine new league-feed records matched the four attempted teams, so the pilot produced zero new pilot-team opportunities and zero source diversity for those teams. The records were still quality-evaluated after a coordinator correction: eight NFL link-only and one manual review.

Because the four-team pilot did not produce useful team-scoped inventory, the full 32-team operation was not run. Hosted candidates moved from 22 to 31, while articles stayed at four (one published and three existing private AI drafts). A query-capable or team-specific source family requires separate source/rights review before another pilot.
