# `baseline-v1`

The baseline is deterministic and uses only normalized PostgreSQL data available before the target kickoff.

- Elo begins at 1500, uses K=20 for regular/postseason games and K=10 for preseason, adds 55 rating points for a non-neutral home field, and regresses 25% toward 1500 between seasons.
- Team statistics use a four-season window weighted 1.2 for available target-season games, then 1.0, 0.65, and 0.35 for the preceding seasons. Inputs are passing/rushing yards and touchdowns, interceptions thrown plus fumbles lost, defensive sacks, defensive interceptions, and forced fumbles.
- The Elo edge, home/neutral context, and a fixed offense/ball-security/disruption composite produce a logistic win probability. Public probabilities are rounded to three decimals and constrained to 0.20–0.80.
- Scores use each team’s recent scored-game average only after at least eight games are available, then apply a bounded probability adjustment. Otherwise both score projections are null.
- Preseason is always low confidence. High confidence requires at least 32 combined weighted-history games and a probability edge of at least 0.18; other sufficiently sampled games are medium.

The complete constants and derived inputs are persisted in the private feature snapshot so any revision can be reproduced. Games and stat aggregates are filtered strictly before kickoff. Because imported 2020–2025 result rows have no factual kickoff timestamp, chronological backtests use season-type/week order and exclude the entire target week; live/upcoming generation still requires a factual kickoff. Regression tests prove later results cannot affect a prediction.
