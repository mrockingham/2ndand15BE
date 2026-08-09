# Launch coverage

`GET /api/v1/admin/editorial/coverage?target=7` returns every active NFL team in abbreviation order. The safe target range is 1-20 and defaults to 7.

Per-team fields are published, active non-duplicate AI draft, available candidate, recent published (30 days), attached video-article, target, and remaining counts. Draft readiness excludes rejected metadata and `LIKELY_DUPLICATE`/`DUPLICATE` overlap classifications. Candidates are reported separately and never count as launch-ready content.

Global totals include teams at/below target plus distinct published articles, active non-duplicate drafts, and available candidates. Per-team counts are associations, so a multi-team story contributes to each tagged team's coverage.

The endpoint does not manufacture stories, scrape sources, generate drafts, publish, or treat content gaps as failures. Generation batches remain explicit, limited to ten distinct candidate IDs, run with concurrency two, and return per-candidate outcomes so one failure does not roll back independent successes.
