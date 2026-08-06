# Stats Hub API guide

Milestone 17 exposes four unauthenticated, PostgreSQL-only endpoints under `/api/v1/stats`. They cover the imported 2020–2025 nflverse records and return dataset-level nflverse attribution under CC BY 4.0. They never contact nflverse or another provider during an HTTP request.

## Endpoints

- `GET /api/v1/stats/metadata` returns imported seasons, supported season types, the ordered public metric registry, exact position and position-group values, limits, ranking rules, coverage notes, and API version `1.0`.
- `GET /api/v1/stats/leaders` requires `season` and `metric`. `seasonType` defaults to `REG`; `POST` and `REG_POST` are explicit alternatives. `position`, `positionGroup`, `teamId`, `limit`, and opaque `cursor` are optional.
- `GET /api/v1/stats/weekly-leaders` additionally requires `week`. It supports `REG` or `POST`, not `REG_POST`.
- `GET /api/v1/stats/recent` requires an internal `playerId` and metric. It returns five recorded appearances by default and accepts at most 20, optionally narrowed by season and `REG`/`POST`.

Leaderboard limits default to 25 and are capped at 100. Historical responses use public cache headers: metadata has a one-day freshness lifetime and other Stats Hub reads have a six-hour freshness lifetime, each with a longer stale-while-revalidate window.

The Team Hub convenience path `GET /api/v1/teams/:teamId/stat-leaders` injects the internal path team into this same season-leader service and otherwise preserves the `/stats/leaders` response, ranking, cursor, metric, season-type, null, zero, and error semantics.

## Ranking and pagination

Leaderboards use PostgreSQL competition ranking: equal metric values receive equal ranks, producing sequences such as `1, 2, 2, 4`. Equal values are ordered deterministically by games descending, player display name ascending, internal player UUID ascending, then an internal row UUID when a weekly player has more than one performance. The opaque cursor carries every ordering component and its metric/context; a cursor from another endpoint or metric is rejected with `STATS_INVALID_CURSOR`. Global ranks are calculated before cursor filtering, so ranks remain meaningful across pages.

All v1 metrics sort descending. Null metric values are excluded from leaderboards. A recorded zero is a factual value and remains eligible. No rate metric or qualification threshold is exposed in v1.

## Team and traded-player semantics

An unfiltered season row uses the stored player-season summary. `teamContext.type` is `SINGLE`, `MULTI`, or `NONE`, with contributing internal team summaries derived from recorded game rows. A multi-team total is never labeled as belonging exclusively to the player’s latest team.

When `teamId` is supplied, the query uses player/game rows and aggregates only production recorded for that team. Its games count is the number of distinct recorded games in that split. This is intentionally a player/team season total, not membership-based qualification for a full-season total.

Weekly rows remain distinct player/game/team performances. If a player has valid records for two teams in one week, both are returned with their own internal game, team, and opponent context.

## Position and season types

Position filters use the position stored on the season summary or game-stat row. They do not infer from the player’s current profile. Exact supported values come from metadata and are case-normalized at the boundary.

Season leaders read the existing `REG`, `POST`, or `REG_POST` summary requested by the client. The service never merges season types. Weekly and recent views support recorded `REG` or `POST` performances only.

## Recent performance

Recent performance supports one player at a time. The database selects the most recent recorded appearances, excluding known future kickoff timestamps, and the response presents those rows chronologically from oldest to newest. It does not synthesize byes, DNP rows, or scheduled games.

The summary reports games represented, known values represented, missing-data count, average, total, minimum, and maximum. Nulls remain null in performance rows and are excluded from calculations. If every selected value is missing, every aggregate is null rather than zero.

## Errors, privacy, and limitations

Validation uses the standard API error envelope. Stable Stats Hub errors include `STATS_METRIC_NOT_FOUND`, `STATS_METRIC_NOT_SUPPORTED_FOR_*`, `STATS_SEASON_NOT_AVAILABLE`, `STATS_POSITION_NOT_SUPPORTED`, and `STATS_INVALID_CURSOR`; missing internal players and teams use `PLAYER_NOT_FOUND` and `TEAM_NOT_FOUND`.

Responses do not expose external player IDs, provider mappings, raw rows, source-row hashes, checksums, filenames, paths, import runs, actors, or conflict metadata. There are no live 2026 player statistics, rate statistics, fantasy metrics, custom scoring, predictions, recommendations, AI analysis, play-by-play, scraping, background jobs, or frontend changes in this milestone.
