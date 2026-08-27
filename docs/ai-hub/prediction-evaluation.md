# Prediction evaluation and operations

Evaluation first locks published predictions whose kickoff has arrived. It then evaluates published/locked predictions only when the normalized game is `FINAL` with both scores. It stores the factual scores, actual winner, correctness, tie flag, and home-outcome Brier score. Ties contribute a 0.5 Brier outcome and are excluded from win/loss accuracy.

Regeneration creates a higher `(game, modelVersion)` revision and never overwrites an earlier snapshot. Public reads resolve the latest visible revision. Publication is explicit and audited. Running evaluation again is idempotent because evaluated rows are no longer selected.

The chronological CLI backtest generates each prediction with that game’s kickoff as its cutoff. It reports accuracy, mean Brier score, tie handling, and the probability-bound sanity gate without writing predictions. This is an operational baseline check, not evidence of predictive superiority; constants must not be tuned on the reported holdout.

Hosted readiness review should record query duration for a single game, a maximum 20-game weekly batch, public list/detail, evaluation, and the preservation counts. No new index is warranted unless measured plans exceed the existing review target.

## August 9, 2026 hosted report

- A bounded chronological 2025 REG sample evaluated 32 decided games: 65.63% accuracy, 0.2031 mean Brier score, and 62.5% home-pick rate. Favorite edges were 10 close, 10 moderate, and 12 strong; confidence was 20 medium and 12 high. All probabilities were finite, summed to one, and remained within the 0.20–0.80 bound.
- A separate 32-game 2024 REG cross-check produced 59.38% accuracy and 0.2342 mean Brier score. No weights were tuned against either sample.
- The Hall of Fame retrospective excluded its own result and target week, predicted Carolina at 55% with a 23–22 projection and low confidence, and remained a private retrospective draft.
- The upcoming POC published three preseason snapshots: BAL 71.6% over CAR (30–18), HOU 78.2% over LV (26–13), and LAC 54.7% over SF (24–23). All are low confidence and explicitly report unavailable injuries, roster availability, weather, and betting markets.
- One OpenAI explanation succeeded after the single bounded remediation path. It used `gpt-5-mini-2025-08-07`, 239 input tokens, 1,074 output tokens, and 14,008 ms. The numerical snapshot was fixed before either call.
- Warm hosted reads measured 91 ms for the three-card list, 74 ms for the derived summary, and 86 ms for detail. The first cold list was 488 ms. Existing indexes are sufficient for the bounded POC.
- Re-publishing an already published snapshot was idempotent, and evaluation returned zero locks/evaluations on two consecutive pre-kickoff runs.
- Hosted preservation: 2,024 games, 330 games in 2026, 112,316 historical player-game rows, exactly one CAR-at-ARI Hall of Fame Game, four prediction rows (three published and one retrospective), and seven prediction audits.

The dependency audit reported zero vulnerabilities. The full suite passed 390 tests with 39 explicitly skipped.
