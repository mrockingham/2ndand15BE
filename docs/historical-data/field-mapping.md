# nflverse historical field mapping

The executable field contract is [`nflverse-field-mappings.ts`](../../src/modules/historical-stats/nflverse-field-mappings.ts). It records each selected stat source column, internal field, Parquet physical type, required/nullable behavior, unit, description, and transformation. Schema version is `nflverse-2026-08-03`; player snapshot version is `nflverse-players-v2-2026-08-03`; mapping versions are `player-identity-v1`, `weekly-rosters-v1`, `player-stats-v1`, and `historical-games-v1`.

## Players

The 39-column source snapshot is inspected. Imported profile/identity columns are:

`gsis_id`, `display_name`, `first_name`, `last_name`, `short_name`, `football_name`, `esb_id`, `nfl_id`, `pfr_id`, `pff_id`, `otc_id`, `espn_id`, `smart_id`, `birth_date`, `position_group`, `position`, `height`, `weight`, `headshot`, `college_name`, `jersey_number`, `rookie_season`, `last_season`, `latest_team`, `status`, `draft_year`, `draft_round`, `draft_pick`, `draft_team`.

Inspected but intentionally omitted are `common_first_name`, `suffix`, `ngs_position_group`, `ngs_position`, `college_conference`, `ngs_status`, `ngs_status_short_description`, `years_of_experience`, `pff_position`, and `pff_status`. They are not needed by the bounded profile contract.

## Weekly rosters

The 37-column source is inspected. Imported membership/identity columns are:

`season`, `team`, `position`, `depth_chart_position`, `jersey_number`, `status`, `full_name`, `first_name`, `last_name`, `gsis_id`, `espn_id`, `sportradar_id`, `yahoo_id`, `pff_id`, `pfr_id`, `sleeper_id`, `years_exp`, `headshot_url`, `week`, `game_type`, `status_description_abbr`, `football_name`, `esb_id`, and `smart_id`.

Inspected but omitted are `birth_date`, `height`, `weight`, `college`, `rotowire_id`, `fantasy_data_id`, `ngs_position`, `gsis_it_id`, `entry_year`, `rookie_year`, `draft_club`, and `draft_number`.

`FA`, `RET`, `RES`, and `UNK` are deliberate non-team codes and map to nullable `teamId`; fake teams are never created. Historical aliases include `JAC -> JAX`, `WSH -> WAS`, `OAK -> LV`, `SD -> LAC`, and `STL/LA -> LAR`.

## Weekly player stats

Identity/context uses `player_id`, `game_id`, `team`, `opponent_team`, `season`, `week`, and `season_type`. Display context reads `player_name`, `player_display_name`, `position`, `position_group`, and `headshot_url`; it is not used to establish identity.

Imported statistic columns are:

- Passing: `completions`, `attempts`, `passing_yards`, `passing_tds`, `passing_interceptions`, `sacks_suffered`, `sack_yards_lost`, `passing_air_yards`, `passing_yards_after_catch`, `passing_first_downs`, `passing_epa`, `passing_2pt_conversions`.
- Rushing: `carries`, `rushing_yards`, `rushing_tds`, `rushing_first_downs`, `rushing_epa`, `rushing_fumbles`, `rushing_fumbles_lost`, `rushing_2pt_conversions`.
- Receiving: `targets`, `receptions`, `receiving_yards`, `receiving_tds`, `receiving_air_yards`, `receiving_yards_after_catch`, `receiving_first_downs`, `receiving_epa`, `target_share`, `receiving_2pt_conversions`.
- Fumbles/defense: `fumbles_total`, `fumbles_lost_total`, `def_tackles_solo`, `def_tackles_with_assist`, `def_tackle_assists`, `def_tackles_for_loss`, `def_sacks`, `def_sack_yards`, `def_qb_hits`, `def_interceptions`, `def_interception_yards`, `def_pass_defended`, `def_fumbles_forced`, `fumble_recovery_opp`, `def_tds`.
- Kicking/returns: `fg_made`, `fg_att`, `pat_made`, `pat_att`, `pt_att`, `pt_yards`, `punt_return_yards`, `pt_return_tds`, `kickoff_return_yards`, `special_teams_tds`.
- Fantasy: source-defined `fantasy_points` and `fantasy_points_ppr`; the names preserve the scoring-system distinction and no scoring formula is assumed.

Inspected but intentionally omitted stat columns are:

`sack_fumbles`, `sack_fumbles_lost`, `passing_cpoe`, `pacr`, `passing_10`, `passing_16`, `passing_20`, `passing_40`, `rushing_10`, `rushing_12`, `rushing_20`, `rushing_40`, `receiving_fumbles`, `receiving_fumbles_lost`, `receiving_10`, `receiving_16`, `receiving_20`, `receiving_40`, `racr`, `air_yards_share`, `wopr`, `def_tackles_for_loss_yards`, `def_fumbles`, `def_safeties`, `misc_yards`, `fumble_recovery_own`, `fumble_recovery_yards_own`, `fumble_recovery_yards_opp`, `fumble_recovery_tds`, `penalties`, `penalty_yards`, `fumbles_forced_by_opp`, `fumbles_not_forced`, `fumbles_out_of_bounds`, `punt_returns`, `kickoff_returns`, `fg_missed`, `fg_blocked`, `fg_long`, `fg_pct`, all distance-bucket/list/distance field-goal fields, `pat_missed`, `pat_blocked`, `pat_pct`, all `gwfg_*` fields, `pt_blocked`, `pt_long`, `pt_inside_20`, `pt_out_of_bounds`, `pt_downed`, `pt_touchback`, `pt_fair_caught`, `pt_returned`, `pt_return_yards`, and `pt_net_yards`.

Counting values must be nonnegative except signed yardage/EPA fields. Completions cannot exceed attempts, receptions cannot exceed targets, and made field goals/extra points cannot exceed attempts. Null and zero remain distinct throughout validation, persistence, aggregation, and DTO mapping.
