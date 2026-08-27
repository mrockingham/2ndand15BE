# Current-season game-stat collection API

`GET /api/v1/games/current-stats` is the provider-neutral collection read for the public Current Season Stats experience. It combines resolved reviewed games and stored `CurrentGameTeamStat` rows in one bounded response, avoiding one browser request per game.

Supported filters are `season`, `seasonType`, `week`, and internal `teamId`. `week=ALL` returns only games in backend-derived available contexts, including a supported null-week special event. When filters are omitted, the current configured NFL season, first supported season type, and latest available numbered week are selected. A season type becomes available only after at least one game has stored team statistics or has reached `PREGAME`, `IN_PROGRESS`, `HALFTIME`, or `FINAL`; future regular-season schedule rows therefore do not prematurely advertise current regular-season statistics.

The response returns each public `Game` with home/away statistics and one coverage classification:

- `COMPLETE`: exactly two correctly oriented rows with every core field present.
- `PARTIAL`: at least one row exists, but orientation or a core value is incomplete.
- `UNAVAILABLE`: a final game has no stored team-stat rows.
- `PENDING`: a non-final game has no stored team-stat rows yet.

Recorded zero remains zero. Missing statistics remain null. The response contains no provider names, mappings, raw payloads, player reconciliation data, or aggregate rankings. Availability and all game statistics are read from PostgreSQL; a public request never calls a sports provider.

The implementation performs three bounded database reads: availability for the configured current season, the resolved game page, and one `IN (...)` team-stat query for all returned game IDs. It performs no N+1 per-game reads and no writes. The response uses a five-minute public cache policy with bounded stale revalidation.

Hosted verification on August 22, 2026 returned 33 available 2026 preseason games across Weeks 1 and 2 plus the null-week Hall of Fame Game: 16 `COMPLETE`, 3 `UNAVAILABLE`, 14 `PENDING`, and 0 `PARTIAL`. The read completed in 1,781.18 ms against the remote database and serialized to 44,347 bytes. Provider-leakage checks were negative.
