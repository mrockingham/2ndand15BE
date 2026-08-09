# Hosted editorial AI enablement

## August 9, 2026 migration and preservation evidence

Migration `20260809000100_add_current_game_player_stats` is strictly additive. It creates only `current_game_player_stats`, `current_game_player_stat_coverage`, their checks/indexes, and foreign keys to existing games, teams, and players. It contains no DML, player reconciliation, provider request, mapping creation, player creation, game mutation, or dependency on the 82 Highlightly profiles.

Migration `20260809000200_add_editorial_ai_pipeline` is also additive. Both migrations were deployed in order through `prisma migrate deploy`; no migration was manually marked applied. Thirteen migrations are applied.

Schema deployment does not mean M22.6 reconciliation ran or completed. No `games:current:details:verify`, `games:current:details:sync`, or Highlightly player-profile request was run. Post-deployment preservation was:

- games: 2,024
- 2026 games: 330
- players: 25,766
- weekly roster rows: 276,063
- historical player-stat rows: 112,316
- Highlightly player mappings: 0
- current-game player-stat rows: 0
- current-game player-stat coverage rows: 0
- player reconciliation audits: 0

M22.6 remains implementation-ready with data reconciliation pending the Highlightly quota and complete 82-profile review.

## Hosted configuration

Hosted generation was verified with `EDITORIAL_AI_PROVIDER=openai`, an explicitly configured `OPENAI_EDITORIAL_MODEL=gpt-5-mini`, and a configured `OPENAI_API_KEY`. `OPENAI_BASE_URL` resolved to the default `https://api.openai.com/v1` and `EDITORIAL_AI_TIMEOUT_MS` to 30,000 ms. Secrets were not printed or persisted by the application.

## Conservative source rights

The one configured source received an audited profile with text, image, video, and quotation permissions all `UNKNOWN`, plus `reviewRequired=true`. The legacy source-level description flag does not override that profile: candidate descriptions were not sent to OpenAI. Generation used headline, publisher, canonical URL, author, publication timestamp, suggested team metadata, and the conservative rights state only. No media was fetched, downloaded, rehosted, or attached.

## Three-candidate hosted sample

All three articles remained `DRAFT` with `NEEDS_REVIEW`, null publish/schedule dates, retained source attribution, no hero image, and no media attachment.

| Source headline (all ESPN, 2026-08-03 03:21:52Z)     | Final draft headline | Words | Category  | Team/player tags | Confidence | Risk flags                                                                   | Duplicate / overlap |
| ---------------------------------------------------- | -------------------- | ----: | --------- | ---------------- | ---------- | ---------------------------------------------------------------------------- | ------------------- |
| 👏 CJGJ pays $20,000 of Bills staffer student loan   | same                 |    34 | OFF_FIELD | BUF / none       | MEDIUM     | THIN_SOURCE, MEDIA_RIGHTS_UNCLEAR, PLAYER_IDENTITY_UNCERTAIN                 | UNIQUE / 0          |
| Samuel on Niners reunion: 'Just matter of time'      | same                 |    67 | PLAYER    | none / none      | LOW        | THIN_SOURCE, QUOTE_INCLUDED, MEDIA_RIGHTS_UNCLEAR, PLAYER_IDENTITY_UNCERTAIN | UNIQUE / 0          |
| Judge issues clarification to NCAA eligibility order | same                 |    49 | OFF_FIELD | none / none      | LOW        | THIN_SOURCE, MEDIA_RIGHTS_UNCLEAR                                            | UNIQUE / 0          |

Generated media-search terms were present for every draft, so no video-search provider was required.

Manual review rejected the first pass for candidate one because it introduced a Twitch mechanism and team-statement claim absent from authorized metadata. Candidate two's first pass interpreted the headline phrase as “imminent.” Both remained private and were regenerated; immutable revisions and audits preserve the failed passes. The provider prompt now treats a null description as the complete factual boundary and explicitly prohibits filling those gaps. The corrected drafts contain only supplied metadata and explicit thin-source limitations, with zero deterministic source overlap and no fabricated quotation.

Candidate three was factually restrained but is NCAA-only and has no NFL/team/player connection. It therefore failed editorial-relevance acceptance. Per the milestone gate, the additional five-candidate batch was not run: requested 0, generated 0, skipped 5, flagged 0, failed 0.

## Coverage and public safety

Coverage target 7 returned all 32 active NFL teams. TB has one published/recent article and needs 6; BUF has one private draft and needs 6; NO has one available candidate and needs 7 because candidates do not count toward target. The other 29 teams have no published article, accepted draft, or team-linked candidate and each needs 7. Totals are one published article, three private AI drafts, 18 available candidates, zero video-enhanced published articles, zero teams at target, and 32 below target.

All three generated IDs returned zero derived-public rows and three private draft rows. AI metadata and five generation/regeneration audits exist only in administrative storage. Existing public DTOs remain unchanged and do not expose provider/model, prompt version, token usage, confidence, risk flags, rights notes, duplicate scores, unresolved players, or audit data.

## Usage, cost, and limitations

Five hosted model calls were made: three initial generations and two remediations. They used 3,395 input tokens and 6,939 output tokens. Observed model time was approximately 84 seconds in total. The adapter does not calculate dollar cost, so `estimatedCostMicros` remains null.

At the observed per-call average, 160-320 one-pass launch drafts would use roughly 108,640-217,280 input tokens and 222,048-444,096 output tokens. This is a directional token estimate, not a price quote, and remediation or retries would increase it.

Remaining limitations are the NCAA relevance gap, conservative unknown rights, no automatic factual grounding beyond supplied metadata, no configured video search, no accepted batch evidence, and no automatic publishing. Human review remains mandatory.
