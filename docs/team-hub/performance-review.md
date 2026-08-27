# Team Hub performance review

Review date: August 5, 2026.

## Query boundaries

- Overview game reads reuse the existing source-isolated team-game query and cap candidates at 100 for one team and the configured 2026 season.
- Overview article reads reuse the existing visible-article service and request three rows.
- Coverage uses three parallel distinct team-scoped reads for roster seasons, stat seasons, and positions.
- Roster aggregation is one team/season query that groups weekly rows to one row per internal player and has a hard 501-row database cap. The service rejects an anomalous team-season above the 500-candidate safety boundary.
- Roster filtering, deterministic ordering, and opaque keyset continuation operate on that naturally bounded team-season player set; response pages remain capped at 100.
- Team leaders execute the existing Stats Hub team-split SQL and its reviewed 100-row maximum.

There are no per-player follow-up queries and no provider/network requests. No schema or index migration was added for Milestone 19 because the existing `player_week_rosters_team_season_week_idx`, player primary key, player latest-team index, game team/season indexes, and Stats Hub indexes cover the access paths.

## Hosted PostgreSQL review

The configured development database contains 192 team-season roster partitions across 32 teams and seasons 2020–2025, 6,470 distinct rostered players, and 276,063 weekly roster rows. Stored roster positions match the reviewed normalized set documented in [semantics](semantics.md).

Representative `EXPLAIN (ANALYZE, BUFFERS)` results on the Kansas City 2025 partition were:

| Query                               |                      Returned rows | Execution | Important access path                                           | Shared buffers |
| ----------------------------------- | ---------------------------------: | --------: | --------------------------------------------------------------- | -------------: |
| Historical roster aggregation       | 105 players from 1,395 weekly rows | 14.689 ms | Bitmap index scan on `player_week_rosters_team_season_week_idx` |     1,113 hits |
| Kansas City passing leaders, `REG`  |            26-row bounded SQL page |  9.246 ms | Bitmap index scan on `player_game_stats_team_season_week_idx`   |      In-memory |
| San Francisco tackle leaders, `REG` |            26-row bounded SQL page | 49.643 ms | Bitmap index scan on `player_game_stats_team_season_week_idx`   |      In-memory |

All plans stayed well below the query-review targets. The roster plan used in-memory quicksorts (largest 344 kB), no disk spill, and memoized the small latest-team join. The leader plans calculated the existing window ranks in memory. The roster plan chose a hash join over the 25,766-player table after its selective roster index scan; at this database size it still completed in under 15 ms, so a speculative player/index migration is not justified.

Three warm remote service samples were taken for each representative read; medians include network round trips and service composition:

| Read                             |   Median |
| -------------------------------- | -------: |
| Team overview                    | 171.3 ms |
| Historical roster                |  80.4 ms |
| Historical roster filtered to WR |  85.2 ms |
| Team passing leaders             |  56.2 ms |
| Team tackle leaders              |  57.8 ms |
| Published team-article preview   |  90.0 ms |
| Stored 2026 team games           |  79.4 ms |

The overview starts the existing Team, Game, Article, and coverage boundaries concurrently, waits for all read-only results, and prioritizes the canonical Team service error if the team is absent. Every measured median met the milestone’s suggested review target. Application caching remains material: overview uses a five-minute freshness window, while historical roster and leader responses use longer lifetimes.

## Preservation snapshot

The final read-only hosted check observed 32 active NFL teams, 64 team/provider mappings, 2,023 games, and the unchanged 329-row 2026 season (320 official baseline rows plus 9 development fixtures, which remain hidden by the public source policy). Historical data remained at 25,766 players, 276,063 weekly roster rows, 112,316 player-game rows, and 27,159 season summaries. Existing application data remained present: 1 user, 4 refresh sessions, 1 article with 3 revisions, 1 news source, 22 news candidates, and 336 audit events.

Milestone 19 made no schema migration and performed no hosted writes. The migration history remained at 10 finished migrations.

## Verification gates

- Prisma format and validation: passed
- Hosted migration status: 10 migrations, schema up to date
- Prettier, ESLint, strict TypeScript, and production build: passed
- Full deterministic suite: 278 passed, 39 intentionally skipped opt-in tests
- All non-live hosted integration suites: 36 passed, 6 intentionally skipped tests; the dedicated Team Hub suite contributed 7 passing tests
- npm audit: 0 vulnerabilities
- Credential-pattern scan and `git diff --check`: passed

The two hosted integration files left disabled were the explicit live news-source check and the API-Sports database check; Milestone 19 makes no live feed/provider calls.
