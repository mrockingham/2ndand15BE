# Stats Hub performance review

Reviewed against the configured Neon development database on August 5, 2026 using `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` over the production query builders. The database contained all imported 2020–2025 historical rows. Times are PostgreSQL execution times, not guarantees for network latency or other environments.

| Query                                               |  Execution | Scan-row total | Principal indexes                                     | Sort                                 |
| --------------------------------------------------- | ---------: | -------------: | ----------------------------------------------------- | ------------------------------------ |
| 2025 REG passing yards, top 25                      | 114.456 ms |         48,580 | season/position stats, season-summary, player/team PK | quicksort + top-N heapsort           |
| 2025 REG rushing yards, top 25                      | 102.520 ms |         48,580 | season/position stats, season-summary, player/team PK | quicksort + top-N heapsort           |
| 2025 REG receiving yards, top 25                    | 103.668 ms |         48,580 | season/position stats, season-summary, player/team PK | quicksort + top-N heapsort           |
| 2025 REG sacks, top 25                              | 100.295 ms |         48,580 | season/position stats, season-summary, player/team PK | quicksort + top-N heapsort           |
| 2025 REG field goals made, top 25                   | 104.534 ms |         48,580 | season/position stats, season-summary, player/team PK | quicksort + top-N heapsort           |
| 2025 REG Week 10 passing yards, top 25              |  30.574 ms |          3,912 | team/season/week stats, game/player PK                | quicksort + top-N heapsort           |
| 2025 Kansas City receiving yards team split, top 25 |   2.704 ms |          1,803 | team/season/week stats, player PK                     | quicksort + top-N heapsort           |
| Patrick Mahomes last five passing-yard appearances  |   0.590 ms |             44 | player/season/week stats, game/team PK                | index order; no explicit sort method |

The metadata service call completed in 34.876 ms from the same client after replacing broad ORM distinct reads with database-side `SELECT DISTINCT` queries. The five full-season plans include a single season-level team-context aggregation; an earlier correlated form scanned about 350,270 row-visits and was replaced before approval. The reviewed form scans about 48,580 row-visits and keeps all representative database execution times below the 250 ms development target.

No endpoint performs N+1 application queries. Ranking and tie counts use SQL window functions, cursor filtering happens after global rank assignment, weekly/team filters use existing composite indexes, and recent player reads use the existing player/season/week index. Plans did not justify another metric-specific index or a materialized view at the current scale, so Milestone 17 adds no migration, Redis cache, or background cache warmer.
