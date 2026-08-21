# Launch coverage

`GET /api/v1/admin/editorial/coverage?target=7` returns every active NFL team in abbreviation order. The safe target range is 1-20 and defaults to 7.

Per-team fields retain published, active non-duplicate AI draft, available candidate, recent published (30 days), attached video-article, target, and remaining counts. Milestone 23.1 adds eligible/full/short/link-only/rejected candidate counts, unique sources, category counts, quality average, and an eligible opportunity total. Unevaluated and rejected candidates never reduce the gap. Evaluated full-draft, short-brief, and link-only opportunities may reduce the discovery inventory gap, while publication readiness remains separately visible.

Global totals include teams at/below target plus distinct published articles, active non-duplicate drafts, and available candidates. Per-team counts are associations, so a multi-team story contributes to each tagged team's coverage.

The endpoint does not manufacture stories, scrape sources, generate drafts, publish, or treat content gaps as failures. Generation batches remain explicit, quality-gated, limited to ten distinct candidate IDs, run with concurrency two, and return per-candidate outcomes so one failure does not roll back independent successes.

Hosted post-pilot coverage remains below target for all 32 teams. BUF has one private draft, TB has one published/recent article, and NO has one evaluated link-only candidate from one source; each has a gap of six at target seven. The other 29 teams have a gap of seven. There are zero full-draft and short-brief eligible candidates, zero video-enhanced articles, and only one team with an evaluated useful candidate association. The 31 total candidates include 27 currently available inbox records; rejected, converted, and untagged records do not inflate team opportunity counts.
