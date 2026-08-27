# Team Hub API guide

Milestone 19 exposes three unauthenticated, read-only Team Hub endpoints under `/api/v1/teams/:teamId`. All path identifiers are application-owned active `Team.id` UUIDs. The routes read PostgreSQL and existing public services only; they never call a sports provider, nflverse, RSS sources, or article pages.

## Overview

`GET /api/v1/teams/:teamId/hub` returns a compact composition for first paint:

- the existing public team DTO;
- at most three upcoming and three recent games from the stored `CURRENT_NFL_SEASON` schedule;
- at most three derived-visible articles using the existing public article list DTO; and
- separate roster/stat season coverage, a latest common default historical season, actual normalized positions/groups, coverage notes, and nflverse attribution.

Upcoming means status `SCHEDULED` or `PREGAME`, ordered by factual kickoff ascending with `startTime: null` (officially TBD) last. Recent means status `FINAL`, ordered by kickoff descending. Scores, times, statuses, game IDs, editorial overrides, fixture isolation, article visibility, and article attribution all retain their existing public semantics.

Featured leader cards are deliberately not embedded in the overview. The dedicated stat-leader endpoint supplies the same authoritative results without adding five leaderboard queries to every overview request.

The response is public-cacheable for 300 seconds with a 1,800-second stale-while-revalidate window.

## Historical roster

`GET /api/v1/teams/:teamId/roster` requires `season` and accepts:

- `position`: `DB`, `DL`, `K`, `LB`, `LS`, `OL`, `P`, `QB`, `RB`, `TE`, or `WR`;
- `positionGroup`: `DB`, `DL`, `LB`, `OL`, `QB`, `RB`, `SPEC`, `TE`, or `WR`;
- `search`: normalized display-name substring, 2–100 characters;
- `limit`: 1–100, default 25; and
- `cursor`: opaque and bound to the team, season, and filters.

One row represents one internal player with at least one stored `PlayerWeekRoster` row for the selected team and season. Each row labels the selected `historicalTeam` separately from the player profile’s `latestKnownTeam`, and returns the latest recorded non-null historical position, jersey, and status, plus first week, last week, and distinct roster-week count. It does not expose external IDs or source rows.

Ordering is position group, position, normalized display name, and internal player UUID. The response is public-cacheable for one day with a seven-day stale-while-revalidate window.

## Team stat leaders

`GET /api/v1/teams/:teamId/stat-leaders` accepts the same parameters as `/api/v1/stats/leaders` except `teamId` comes only from the path. It requires `season` and `metric`; `seasonType` defaults to `REG` and supports `POST` and `REG_POST`. Position filters, limit, and opaque cursor retain the Stats Hub contract.

The endpoint calls the existing Stats Hub season-leader service with the path team injected. Metric allowlisting, team-only player/game aggregation, competition ranks, tie ordering, null exclusion, factual-zero inclusion, pagination, errors, privacy, and nflverse attribution are therefore identical. Cache freshness is six hours with a one-day stale-while-revalidate window.

## Errors

All routes use the shared error envelope. Important stable codes are:

- `VALIDATION_ERROR` for malformed path/query input;
- `TEAM_NOT_FOUND` for an absent or inactive NFL team;
- `TEAM_ROSTER_SEASON_NOT_AVAILABLE` for a season with no recorded roster membership;
- `TEAM_ROSTER_POSITION_NOT_SUPPORTED` for a roster position/group outside the documented set;
- `TEAM_ROSTER_INVALID_CURSOR` for malformed or cross-filter roster cursors;
- `TEAM_ROSTER_QUERY_TOO_BROAD` if anomalous stored data exceeds the 500-player team-season safety boundary; and
- the existing `STATS_*` errors for the stat-leader route.

The existing independently paginated `GET /api/v1/teams/:teamId/articles` route remains the complete Team Hub news feed.

## Examples

```http
GET /api/v1/teams/a1fe9c2c-51d7-4407-9d14-4808c62174f4/hub
GET /api/v1/teams/a1fe9c2c-51d7-4407-9d14-4808c62174f4/roster?season=2025&positionGroup=WR&limit=25
GET /api/v1/teams/a1fe9c2c-51d7-4407-9d14-4808c62174f4/stat-leaders?season=2025&metric=receiving_yards
```

An abridged roster response has this shape:

```json
{
  "data": {
    "team": { "id": "a1fe9c2c-51d7-4407-9d14-4808c62174f4", "abbreviation": "KC" },
    "season": 2025,
    "roster": [
      {
        "player": {
          "id": "00000000-0000-4000-8000-000000000001",
          "displayName": "Example Player",
          "headshotUrl": null
        },
        "season": 2025,
        "historicalTeam": {
          "id": "a1fe9c2c-51d7-4407-9d14-4808c62174f4",
          "abbreviation": "KC",
          "fullName": "Kansas City Chiefs"
        },
        "latestKnownTeam": null,
        "position": "WR",
        "positionGroup": "WR",
        "jerseyNumber": null,
        "status": null,
        "firstWeek": 1,
        "lastWeek": 18,
        "rosterWeekCount": 18
      }
    ]
  },
  "meta": { "nextCursor": null, "attribution": { "source": "nflverse", "license": "CC BY 4.0" } }
}
```

The real response includes the full existing Team DTO and the roster-semantics strings documented above. Cursors must be treated as opaque.
