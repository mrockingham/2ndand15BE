# Data limitations and rights review

The August 9, 2026 hosted suitability check found complete scored outcomes for 2020–2025 REG/POST games and non-null coverage for all selected fields across 112,316 normalized nflverse player-game rows. Those historical games have factual season/type/week but null kickoff timestamps, so backtesting uses a conservative season-type/week cutoff and excludes the target week. The model uses application-owned team/game IDs and normalized aggregates; it exposes no nflverse IDs, raw rows, source paths, checksums, or import metadata.

The selected historical data retains the project’s existing nflverse CC BY 4.0 attribution obligations. Current-game providers are not called by prediction generation and their private identifiers or payloads are not inputs. OpenAI receives only team names, venue context, fixed probabilities/scores/confidence, and deterministic factor labels. Its prose is optional, metadata is private, and unsupported player, injury, roster, weather, or betting language is rejected.

Known absences are persisted as flags: injuries, current roster availability, depth charts, weather, and betting markets are unavailable. Historical player statistics cover 2020–2025; there are no 2026 historical player-stat rows. Preseason history is sparse, so preseason confidence is forced low. A null kickoff prevents generation. A null week is supported for a specifically selected preseason game but not inferred as a normal weekly slate.

Predictions are estimates, not facts or wagering advice. They must be labeled with model version, generation time, confidence, and evaluation status in clients.
