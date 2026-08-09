# Editorial AI assistant

Milestone 23 extends the existing `NewsCandidate -> Article` workflow. It does not create a second news system and never publishes automatically.

```text
bounded candidate metadata
  -> deterministic duplicate/source-rights preparation
  -> provider-neutral EditorialAiProvider
  -> strict normalized draft result
  -> internal team/player resolution and originality check
  -> Article DRAFT + revision + private AI metadata + audit (one transaction)
  -> NEEDS_REVIEW
  -> existing human CMS approval/publication workflow
```

`EditorialAiProvider` owns generation transport. The first optional adapter uses the OpenAI Responses API with strict structured output. Controllers and persistence contain no OpenAI-specific request shape. Configure `EDITORIAL_AI_PROVIDER=openai`, `OPENAI_API_KEY`, and an explicit `OPENAI_EDITORIAL_MODEL`; otherwise generation returns a sanitized `503` and every existing CMS/inbox route continues to work.

The prompt version is `editorial-draft-v1`. It requires original wording, factual attribution, no publisher-style imitation, no fabricated facts/quotes/statistics/injuries/contracts, and short attributed quotations only when necessary. The backend independently measures five-word phrase overlap when approved source description text is available. A score at or above `0.35` adds `SOURCE_OVERLAP`; it never attempts mechanical synonym substitution.

AI drafts are `ORIGINAL` CMS records with source name/URL provenance. They are always stored as `DRAFT`; private `ArticleAiMetadata.reviewStatus` starts at `NEEDS_REVIEW`. Approval changes only this private review state and does not publish. Existing publish/schedule operations remain the only publication boundary.

Private metadata includes provider/model/prompt version, confidence, risk flags, category/topic tags, unresolved entities, duplicate classification, source-overlap score, token usage when supplied, and phase timings. None is selected by public article DTOs. Hidden reasoning is neither requested nor stored.

## Admin operations

- `POST /api/v1/admin/news-candidates/:candidateId/generate-draft`
- `POST /api/v1/admin/news-candidates/generate-drafts` (1-10 distinct IDs, concurrency 2)
- `POST /api/v1/admin/articles/:articleId/editorial-review`
- `POST /api/v1/admin/articles/:articleId/regenerate` (current draft version only)
- `POST /api/v1/admin/articles/:articleId/media-candidates`
- `POST /api/v1/admin/articles/:articleId/media/:mediaCandidateId/attach`
- `GET /api/v1/admin/editorial/coverage?target=7`
- `GET|PUT /api/v1/admin/news-sources/:sourceId/rights`

Generation independently resolves exact NFL team names/abbreviations to the active 32-team catalog. Player suggestions require one exact normalized-name result with compatible team context; fuzzy/ambiguous suggestions remain private unresolved entities and never create players.

Known limitations: candidate metadata contains no full article text; unreviewed or non-approved source descriptions are omitted, producing shorter low-confidence briefs. Semantic duplicate comparison, automatic YouTube search, and launch preparation are not active in this implementation. Media search terms are returned for manual/approved search workflows.

Hosted deployment prerequisites, the M22.6 schema/data distinction, preservation evidence, and the current configuration blocker are recorded in [hosted-enablement.md](hosted-enablement.md).
