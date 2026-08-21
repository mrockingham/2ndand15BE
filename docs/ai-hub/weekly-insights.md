# Tier 1 weekly intelligence

`GET /api/v1/ai-hub/weekly-insights` is a provider-neutral, read-only view over the latest published, locked, or evaluated non-retrospective prediction for each game in one reviewed NFL schedule week. `season`, `seasonType`, and `week` are required. `teamId` adds one favorite-team view; `top` bounds ranked lists from 1 to 5 and defaults to 5.

The endpoint performs two bounded PostgreSQL reads: one maximum-80 snapshot query for the exact week and one maximum-400 evaluated-prediction query for the selected season and season type. It creates no rows, calls no provider or AI service, and caches public responses for five minutes.

## Deterministic derivations

- Strongest and confidence rankings sort by the model favorite probability. Closest matchup sorts toward `0.5`. Existing `LOW`, `MEDIUM`, and `HIGH` labels are carried through unchanged; a ranking never promotes confidence.
- Highest and lowest scoring games use the sum of the existing projected scores.
- Blowout score combines 60% normalized probability gap (`gap / 0.60`) and 40% normalized projected margin (`margin / 28`), each capped at one. This is a comparative model signal, not a guarantee.
- Upset watch first identifies a model favorite opposed by the stored `TEAM_STRENGTH` factor. If no such reversal exists, it identifies the underdog in the closest matchup under the explicit `MODEL_UNCERTAINTY` basis. It does not use markets, spreads, or odds.
- Offensive edge uses only historical passing yards, rushing yards, passing touchdowns, and rushing touchdowns. Defensive edge uses sacks, defensive interceptions, and forced fumbles. Turnover-profile edge uses historical turnovers, defensive interceptions, and forced fumbles. Fixed normalization references make comparisons reproducible; `tanh` bounds the absolute relative edge to zero through one.
- Favorite-team probability, opponent, winner flag, projected score, confidence, safe factors, and weekly rank are derived from that team's one weekly prediction. An active team with no eligible prediction returns `favoriteTeamPrediction: null`.
- Model performance uses only evaluated snapshots for the same season type and matching model version. Accuracy excludes ties; Brier score includes stored evaluated values. With no evaluations, counts are zero and rates are `null`. Previous week means the greatest evaluated week below the requested week.

Ties are resolved by kickoff and stable internal game ID. Invalid private feature data omits the affected feature edge rather than guessing. Raw feature snapshots, raw availability objects, external/provider identifiers, AI prompts, model usage, tokens, timings, actors, and audits are never returned.

No player intelligence, fantasy advice, wagering data, injuries, depth charts, weather, live provider calls, scheduling, cron, queues, or workers are part of this milestone.

## Hosted Week 1 verification

On August 9, 2026, the read-only endpoint used all 16 published `baseline-v1` 2026 preseason Week 1 snapshots and returned HTTP 200. It derived SF over TEN as strongest (78.5%, LOW), KC over LAR as closest (51.3%, LOW), BAL over PHI as the historical-strength-reversal upset watch, CAR at BUF as the strongest blowout signal, DET at CIN as highest projected total (57), and CLE at CHI as lowest (38). The top offense, defense, and turnover-profile edges were BUF over CAR, PIT over GB, and CHI over CLE respectively.

Favorite-team checks returned SF as the predicted winner/rank 1 and LAR as the predicted loser/rank 16. With no evaluated Week 1 games, the season record correctly returned zero games with `accuracy` and `brierScore` null. A repeated service result was byte-for-byte stable; the public payload was about 35.7 KB, a warm hosted service read was 116.6 ms, and the endpoint uses two database queries. Prediction row count remained 20 before and after verification. Privacy scans found no raw feature/availability object, provider ID, prompt, token, odds, spread, or betting field.
