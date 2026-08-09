# Current-game performance report

Date: August 8, 2026

The hosted Hall of Fame Game proof used one Highlightly request per command and one targeted internal-game lookup. No performance concern justified a new index or `EXPLAIN ANALYZE`.

| Run                    | Provider | Match | Database |    Total | Outcome      |
| ---------------------- | -------: | ----: | -------: | -------: | ------------ |
| Read-only verification |   492 ms | <1 ms | 1,319 ms | 1,812 ms | would update |
| Explicit dry-run       |   265 ms | <1 ms |   508 ms |   774 ms | would update |
| First apply            |   356 ms | <1 ms |   766 ms | 1,123 ms | updated 1    |
| Repeat apply           |   293 ms | <1 ms |   599 ms |   893 ms | unchanged 1  |

Each provider request returned a 49-record season envelope; the adapter retained only the one record inside the target's ±12-hour window. Apply used one small transaction for the existing game update, mapping creation, and private audit. The repeat run used the existing mapping and performed no transaction.

These timings include hosted-network latency and are operational observations, not a production service-level objective. No scheduler or concurrency claim is implied.
