# nflverse player statistics: 2020-2025 review

**Decision:** READY. All six seasons are imported in the configured Neon database. Schema, mapping, validation, idempotency, reconciliation, API privacy, and preservation checks passed with documented non-player/name-only source warnings.

## Manifest and source versions

The authoritative manifest is [`nflverse-2020-2025.json`](../../data/nflverse/manifests/nflverse-2020-2025.json). It records exact release URLs, timestamps, file sizes, and SHA-256 checksums for the `players`, `weekly_rosters`, `stats_player`, and `schedules` releases. The ten 2020-2024 Parquet checksums are:

| Season | Weekly roster SHA-256                                              | Weekly stats SHA-256                                               |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 2020   | `8d601bf5c5d669465481421ad5cd1a1470d51792054e84bdc04f3620785f7530` | `fae7c9c51c8df8eb5db73c4197aa8f3c95e0751b345d9c66f82c3b0499af31d2` |
| 2021   | `3e9f67569e940b54b3778ef2c9150850920b5bf93143bad3bd158e649825cf6b` | `32e39722e23ec294f6717991c05c7017d9b5dcda8a0c4eb14d27da5c4367557b` |
| 2022   | `063c0da93f612811e1c4a4c12727a56fd2716197864795f15aa2f10a591b00c0` | `1806dbd3be000d424c7486f98903ac2928af706d3902252161b811cd1401bbb6` |
| 2023   | `0fa5abf9b462a087ecb17f3268ed7233ce9935e95d77be94ad6bac66adf8e281` | `72bd4a3c0a2bb92b00c6d6695f956cbf9184ea322610546397c248bf272879b4` |
| 2024   | `4b144e8eda5a159f36037b02e8b7d5a7861acb65b0816b0a063244992038dcf8` | `ca7a7f08061fc41c483847240c463c4a559d680006b17e5e18c0eef8f027c2df` |

The 2025 checksums are in [the pilot report](nflverse-player-stats-2025-pilot.md). nflverse contributors are attributed as the original collectors under CC BY 4.0. No play-by-play or supplemental non-core dataset was imported.

## Full review

| Dataset  | Season | Source rows | Accepted |                         Warnings | Missing player/game mappings |
| -------- | -----: | ----------: | -------: | -------------------------------: | ---------------------------: |
| Schedule |   2020 |         269 |      269 |                                0 |                        0 / 0 |
| Schedule |   2021 |         285 |      285 |                                0 |                        0 / 0 |
| Schedule |   2022 |         284 |      284 |                                0 |                        0 / 0 |
| Schedule |   2023 |         285 |      285 |                                0 |                        0 / 0 |
| Schedule |   2024 |         285 |      285 |                                0 |                        0 / 0 |
| Schedule |   2025 |         285 |      285 |                                0 |                        0 / 0 |
| Players  |    all |      25,039 |   25,039 |                                2 |                        0 / 0 |
| Rosters  |   2020 |      44,130 |   44,130 |                               52 |                        0 / 0 |
| Rosters  |   2021 |      46,696 |   46,693 |                               58 |                        0 / 0 |
| Rosters  |   2022 |      46,163 |   46,162 |                              158 |                        0 / 0 |
| Rosters  |   2023 |      45,655 |   45,654 |                              147 |                        0 / 0 |
| Rosters  |   2024 |      46,579 |   46,579 |                              174 |                        0 / 0 |
| Rosters  |   2025 |      46,849 |   46,845 | 4 after pilot identities existed |                        0 / 0 |
| Stats    |   2020 |      17,602 |   17,581 |                               21 |                        0 / 0 |
| Stats    |   2021 |      18,969 |   18,947 |                               22 |                        0 / 0 |
| Stats    |   2022 |      18,831 |   18,809 |                               22 |                        0 / 0 |
| Stats    |   2023 |      18,643 |   18,621 |                               22 |                        0 / 0 |
| Stats    |   2024 |      18,981 |   18,959 |                               22 |                        0 / 0 |
| Stats    |   2025 |      19,421 |   19,399 |                               22 |                        0 / 0 |

The full dry run reviewed 415,251 source rows, accepted 415,111, emitted 726 warnings, and had zero failures. Warnings cover 584 pre-2025 roster-only stable identities, nine roster rows with no usable ID, 131 non-player stat aggregate rows, one invalid measurement, and one consistent duplicate profile merge. No unknown teams or duplicate stat rows were found. Exact source/imported/omitted columns are in [the field-mapping guide](field-mapping.md).

The final post-import rerun had the same source/accepted/failure counts and 142 warnings because the 584 roster-derived identities now resolve from the database; this confirms the warning reduction is expected persisted identity state, not dropped data.

## Imported state and execution

| Season | Games | Rosters |  Stats | Summaries | Write duration | Growth bytes |
| ------ | ----: | ------: | -----: | --------: | -------------: | -----------: |
| 2020   |   269 |  44,130 | 17,581 |     4,487 |      143.576 s |   29,818,880 |
| 2021   |   285 |  46,693 | 18,947 |     4,688 |      132.263 s |   32,595,968 |
| 2022   |   284 |  46,162 | 18,809 |     4,533 |      182.897 s |   33,955,840 |
| 2023   |   285 |  45,654 | 18,621 |     4,387 |      177.616 s |   33,046,528 |
| 2024   |   285 |  46,579 | 18,959 |     4,493 |      152.860 s |   32,038,912 |
| 2025   |   285 |  46,845 | 19,399 |     4,571 |      190.593 s |    see pilot |

The final database contains 25,766 internal players, 143,097 external identifier mappings, 276,063 weekly roster rows, 112,316 player-game rows, and 27,159 summaries: 12,027 `REG`, 3,069 `POST`, and 12,063 `REG_POST`. Player summaries span teams and retain `teamCount`, preventing traded-player double counting.

The final database size is 262,291,456 bytes. It was 11,976,704 bytes before the first pilot write, for total growth of 250,314,752 bytes (about 238.7 MiB). New relation sizes total 145,162,240 table bytes and 103,456,768 index bytes. The largest are weekly rosters (59,637,760 table / 46,309,376 index) and game stats (54,165,504 / 24,231,936). This is below the configured 500 MiB per-import safety ceiling, but storage should be monitored before adding play-by-play or further wide datasets.

## Season reconciliation

Official nflverse `stats_player_reg_YEAR.parquet` files were downloaded only for comparison. Across 12,027 identifiable regular-season player summaries and 27 stored fields, local weekly sums had:

- zero value mismatches;
- zero missing player mappings;
- zero missing local summaries;
- zero local-only summaries.

Each source season summary contains one unidentifiable non-player aggregate row; it is the only warning. Reconciliation file checksums and field-level results are generated by `historical:reconcile` and documented by the command output.

## Preservation and API checks

Before and after counts remained: 1 user, 4 sessions, 32 teams, 329 games in season 2026, 0 game overrides, 64 team-provider mappings, 1 article, 22 news candidates, and 336 audit events. Historical imports added factual 2020-2025 games and nflverse mappings without changing the 2026 schedule, authentication/session data, editorial content, candidates, or audit history.

All four public player routes returned `200` in a real-database smoke test. Pagination and attribution were present; provider identifiers and import metadata were absent.

## Known limitations and boundary

- Historical kickoff times are null because this milestone imports identity, not an inferred local timestamp.
- Headshot URLs are external metadata with fallback expected at the frontend.
- Name-only roster and non-player aggregate rows remain deliberately excluded.
- No play-by-play, drives, participation, snaps, injuries, depth charts, contracts, betting, prediction/AI, frontend, scheduler, queue, Redis, or live-provider request work was added.
