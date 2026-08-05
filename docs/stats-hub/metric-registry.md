# Stats Hub metric registry

The version `1.0` registry in `src/modules/stats-hub/stats-metrics.ts` is the only public metric allowlist. Request values resolve to a definition before repository access. SQL expressions are selected from trusted internal mappings; request text never becomes a SQL identifier. Public metadata deliberately omits internal source fields.

Every v1 metric is a descending volume total, is available for season leaders, weekly leaders, and recent performance, excludes null leaderboard values, and has no minimum-volume qualification. Rate and fantasy metrics are deferred.

| Category  | Metric ID                 | Label                   | Type              | Definition                                     |
| --------- | ------------------------- | ----------------------- | ----------------- | ---------------------------------------------- |
| Passing   | `passing_yards`           | Passing Yards           | Integer           | Recorded passing yards                         |
| Passing   | `passing_touchdowns`      | Passing Touchdowns      | Integer           | Recorded passing touchdowns                    |
| Passing   | `completions`             | Completions             | Integer           | Recorded completed passes                      |
| Passing   | `passing_attempts`        | Passing Attempts        | Integer           | Recorded pass attempts                         |
| Passing   | `interceptions_thrown`    | Interceptions Thrown    | Integer           | Recorded passing interceptions                 |
| Rushing   | `rushing_yards`           | Rushing Yards           | Integer           | Recorded rushing yards                         |
| Rushing   | `rushing_touchdowns`      | Rushing Touchdowns      | Integer           | Recorded rushing touchdowns                    |
| Rushing   | `rushing_attempts`        | Rushing Attempts        | Integer           | Recorded carries                               |
| Receiving | `receiving_yards`         | Receiving Yards         | Integer           | Recorded receiving yards                       |
| Receiving | `receiving_touchdowns`    | Receiving Touchdowns    | Integer           | Recorded receiving touchdowns                  |
| Receiving | `receptions`              | Receptions              | Integer           | Recorded receptions                            |
| Receiving | `targets`                 | Targets                 | Integer           | Recorded targets                               |
| Defense   | `tackles`                 | Total Tackles           | Integer           | Recorded solo tackles plus tackle assists      |
| Defense   | `solo_tackles`            | Solo Tackles            | Integer           | Recorded solo tackles                          |
| Defense   | `sacks`                   | Sacks                   | Decimal (1 place) | Recorded defensive sacks, including half-sacks |
| Defense   | `defensive_interceptions` | Defensive Interceptions | Integer           | Recorded defensive interceptions               |
| Defense   | `forced_fumbles`          | Forced Fumbles          | Integer           | Recorded forced fumbles                        |
| Kicking   | `field_goals_made`        | Field Goals Made        | Integer           | Recorded made field goals                      |
| Kicking   | `field_goals_attempted`   | Field Goals Attempted   | Integer           | Recorded field-goal attempts                   |
| Kicking   | `extra_points_made`       | Extra Points Made       | Integer           | Recorded made extra points                     |

Registry validation rejects duplicate IDs, definitions unavailable in every public context, empty stored-field mappings, and category/source mismatches. TypeScript constrains stored mappings to numeric fields that exist on both `PlayerSeasonStat` and `PlayerGameStat`. Tests additionally confirm stable category ordering and that serialized public definitions contain no source mapping.

Completion percentage, field-goal percentage, catch percentage, per-game/per-attempt rates, and fantasy scoring are not v1 metrics. Adding one requires a separately reviewed stable ID, clear denominator and qualification threshold, null behavior, season/week/recent support, documentation, OpenAPI, query-plan review, and tests.
