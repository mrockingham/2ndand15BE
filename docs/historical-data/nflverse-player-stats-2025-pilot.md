# nflverse player statistics: 2025 pilot

**Decision:** PASS WITH DOCUMENTED WARNINGS. The write completed on August 3, 2026, all identifiable mappings resolved, public API smoke tests passed, and the identical second import created/updated zero source rows.

## Sources

| Dataset        | Release/file                                  |     Bytes | SHA-256                                                            |
| -------------- | --------------------------------------------- | --------: | ------------------------------------------------------------------ |
| Schedules      | `schedules/games.csv`                         | 2,172,881 | `4720b962a8bbc0c435620bc2c9c70474530296d80a3811c4d698fa68521f39e5` |
| Players v2     | `players/players.parquet`                     | 3,405,836 | `b2a467baa47b25b7e0af22b88a54c9c50fec7f6c072ab88c543740cb66f58a13` |
| Weekly rosters | `weekly_rosters/roster_weekly_2025.parquet`   |   850,871 | `a8764c947bfe6a9d8f122a194e3f026973c8efcc8a3456c67cbfac4371c20342` |
| Weekly stats   | `stats_player/stats_player_week_2025.parquet` |   852,704 | `afc45559f6385a3f253887f37efcb1124006db799c91a58d8c7151429136f0cc` |

All are core nflverse-data releases under CC BY 4.0. Exact timestamps and URLs are in [`nflverse-2025-pilot.json`](../../data/nflverse/manifests/nflverse-2025-pilot.json). Source/imported/omitted columns are documented in [the field mapping](field-mapping.md).

## Review results

| Dataset             | Source | Accepted |                  Warnings | Failures |
| ------------------- | -----: | -------: | ------------------------: | -------: |
| Schedules           |    285 |      285 |                         0 |        0 |
| Player profiles     | 25,039 |   25,039 |                         2 |        0 |
| Weekly rosters      | 46,849 |   46,845 | 148 on the initial review |        0 |
| Weekly player stats | 19,421 |   19,399 |                        22 |        0 |
| Total               | 91,594 |   91,568 |                       172 |        0 |

The two profile warnings are one out-of-range legacy weight, which is omitted rather than converted, and two source rows for Layne Pryor that consistently overlap on stable identifiers. They merge to one internal player, preferring the canonical GSIS profile. Roster warnings comprised 144 stable-ID roster-only players and four name-only rows; only the name-only rows were skipped. The 22 stat warnings are upstream non-player aggregate rows without `player_id`.

All 2,024 identifiable stat players, 285 games, and 32 teams resolved. There were no identity collisions, unknown teams, missing player mappings, missing game mappings, or duplicate player/game/team rows. Aggregate review totals were 18,369 pass attempts, 15,315 carries, 11,749 receptions, 2,293 touchdowns, 9,249 defensive-coverage rows, and 1,114 kicking rows.

## Import and storage

The first write correctly stopped on the cross-identifier transition row and recorded a failed run. The gate was corrected to classify and merge consistent overlapping IDs; no name matching was introduced. The successful retry took 190.593 seconds and rebuilt 4,571 summaries. Logical final pilot state was 25,182 players (25,038 unique profile identities plus 144 roster-only identities), 141,453 external identifiers, 46,845 rosters, 19,399 stats, and 285 nflverse game mappings.

The successful retry reported growth from 49,250,304 to 99,074,048 bytes (49,823,744 bytes). Including bounded batches committed before the diagnostic stop, the first pilot sequence began at 11,976,704 bytes. The large share is expected from 141,453 identifier rows and their uniqueness indexes. It remained below the configured 500 MiB stop threshold.

The identical second write took 93.212 seconds and reported:

- Schedules: 0 created, 0 updated, 285 skipped.
- Players: 0 created, 0 updated, 25,039 skipped.
- Rosters: 0 created, 0 updated, 46,845 skipped.
- Stats: 0 created, 0 updated, 19,399 skipped.

It added only import metadata and MVCC space from the then delete/recreate summary implementation (1,499,136 bytes). Summary rebuilds were subsequently improved to retain unchanged rows.

## API and readiness

Real-database smoke requests to list, detail, weekly-stat, and season-summary endpoints all returned `200`. The weekly request returned three bounded records; the season endpoint returned 17 records for the test player. Attribution appeared once in response metadata and privacy scans found no provider IDs, checksums, source paths, or actor identities.

Pilot 1 passed the review gate. The approved 2020-2024 one-season-at-a-time import could proceed.
