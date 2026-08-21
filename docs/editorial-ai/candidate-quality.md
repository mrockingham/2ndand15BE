# Candidate quality gate

Every candidate must receive a private, persisted quality evaluation before first-time AI draft generation. The evaluation is additive to the existing `NewsCandidate`; it does not create another inbox or public content model.

The relevance gate is deterministic first. Strong NFL evidence includes an approved NFL-scoped source/URL, an exact suggested internal team, explicit NFL league language, or a clearly NFL-connected draft/pro-day story. NCAA eligibility, recruiting, college-only coverage, high school sports, and other leagues are `NOT_NFL` unless concrete NFL context is present. Ambiguous records may use the configured compact OpenAI classifier, whose strict result is `NFL`, `NOT_NFL`, or `UNCERTAIN`; it cannot overturn a deterministic high-confidence non-NFL result.

Sufficiency considers only material the backend is authorized to use. A description counts only when the source allows it and its reviewed rights profile is `SUMMARY_ALLOWED`. The decisions are:

- `FULL_DRAFT_ELIGIBLE`: enough authorized facts for ordinary drafting.
- `SHORT_BRIEF_ELIGIBLE`: enough for an attributed 40-120 word brief without filler.
- `LINK_ONLY`: useful NFL discovery metadata, but no safe article body.
- `INSUFFICIENT`: too little meaningful information.
- `MANUAL_REVIEW`: conflicting or unresolved evidence.

Final decisions additionally apply exact and near-duplicate checks. Non-NFL, duplicate, insufficient, and link-only records cannot call article generation. Short briefs and full drafts pass an explicit content mode to the provider. The prompt forbids padding and treats missing descriptions as a hard factual boundary.

The normalized 0-100 score is interpretable rather than opaque. Stored components cover relevance, sufficiency, freshness, resolved entities, configurable source preference, rights clarity, and duplicate penalty. Classifier tokens and duration are separate from article-generation usage.

Administrators can evaluate one candidate, evaluate up to 50 distinct candidates with concurrency four, or record an audited override. Overrides may adjust relevance/content format and explicitly allow a duplicate, but they never change source rights, create an article, or publish.

Private endpoints:

- `POST /api/v1/admin/news-candidates/:candidateId/evaluate`
- `POST /api/v1/admin/news-candidates/evaluate-batch`
- `POST /api/v1/admin/news-candidates/:candidateId/quality-override`

Quality factors, reasons, search/provider details, rights notes, scores, and token use remain absent from public article routes.

## Hosted evaluation evidence — August 9, 2026

The original 22 candidates were evaluated without generating drafts. Results were 20 NFL, one deterministic non-NFL, and one AI-assisted uncertain/manual-review record. Available authorized material yielded zero full-draft, zero short-brief, 21 link-only, zero insufficient, and three duplicate decisions. The previously identified NCAA eligibility candidate was deterministically `REJECT_NON_NFL` even though it already had a private draft from M23 verification.

Twenty-one evaluations were deterministic. One uncertain record used 203 input and 437 output classification tokens in 8,051 ms. The subsequent nine bounded pilot records produced eight deterministic NFL link-only decisions and one AI-assisted manual review (212 input, 496 output tokens in 7,649 ms). Across all 31 candidates: 28 are NFL, one is non-NFL, two need manual review, 25 are useful link-only, and three are duplicates. Total classification usage was 415 input and 933 output tokens over 15,700 ms; 29 of 31 evaluations avoided AI.

A hosted generation smoke attempted one unconverted link-only candidate and the rejected NCAA candidate with a provider that records calls. Both returned `CANDIDATE_NOT_GENERATION_ELIGIBLE`, the provider call count remained zero, and article/AI-metadata counts stayed four/three.
