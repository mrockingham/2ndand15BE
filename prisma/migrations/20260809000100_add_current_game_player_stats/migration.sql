CREATE TABLE "current_game_player_stats" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "passing_completions" INTEGER,
    "passing_attempts" INTEGER,
    "passing_yards" INTEGER,
    "passing_touchdowns" INTEGER,
    "passing_interceptions" INTEGER,
    "sacks_suffered" INTEGER,
    "sack_yards_lost" INTEGER,
    "rushing_attempts" INTEGER,
    "rushing_yards" INTEGER,
    "rushing_touchdowns" INTEGER,
    "longest_rush" INTEGER,
    "targets" INTEGER,
    "receptions" INTEGER,
    "receiving_yards" INTEGER,
    "receiving_touchdowns" INTEGER,
    "longest_reception" INTEGER,
    "fumbles" INTEGER,
    "fumble_recoveries" INTEGER,
    "tackles_total" INTEGER,
    "tackles_solo" INTEGER,
    "defensive_sacks" DOUBLE PRECISION,
    "tackles_for_loss" INTEGER,
    "passes_defended" INTEGER,
    "defensive_touchdowns" INTEGER,
    "field_goals_made" INTEGER,
    "field_goals_attempted" INTEGER,
    "longest_field_goal" INTEGER,
    "extra_points_made" INTEGER,
    "extra_points_attempted" INTEGER,
    "punts" INTEGER,
    "punt_yards" INTEGER,
    "punt_average" DOUBLE PRECISION,
    "punts_inside_20" INTEGER,
    "punt_touchbacks" INTEGER,
    "longest_punt" INTEGER,
    "kick_returns" INTEGER,
    "kick_return_yards" INTEGER,
    "kick_return_touchdowns" INTEGER,
    "longest_kick_return" INTEGER,
    "punt_returns" INTEGER,
    "punt_return_yards" INTEGER,
    "punt_return_touchdowns" INTEGER,
    "longest_punt_return" INTEGER,
    "source_provider" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "current_game_player_stats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "current_game_player_stats_nonnegative_check" CHECK (
      "passing_completions" >= 0 AND "passing_attempts" >= 0 AND
      "passing_touchdowns" >= 0 AND "passing_interceptions" >= 0 AND
      "sacks_suffered" >= 0 AND "sack_yards_lost" >= 0 AND
      "rushing_attempts" >= 0 AND "rushing_touchdowns" >= 0 AND
      "targets" >= 0 AND "receptions" >= 0 AND
      "receiving_touchdowns" >= 0 AND "fumbles" >= 0 AND
      "fumble_recoveries" >= 0 AND "tackles_total" >= 0 AND
      "tackles_solo" >= 0 AND "defensive_sacks" >= 0 AND
      "tackles_for_loss" >= 0 AND "passes_defended" >= 0 AND
      "defensive_touchdowns" >= 0 AND "field_goals_made" >= 0 AND
      "field_goals_attempted" >= 0 AND "longest_field_goal" >= 0 AND
      "extra_points_made" >= 0 AND "extra_points_attempted" >= 0 AND
      "punts" >= 0 AND "punt_yards" >= 0 AND "punt_average" >= 0 AND
      "punts_inside_20" >= 0 AND "punt_touchbacks" >= 0 AND
      "longest_punt" >= 0 AND "kick_returns" >= 0 AND
      "kick_return_touchdowns" >= 0 AND "punt_returns" >= 0 AND
      "punt_return_touchdowns" >= 0
    ),
    CONSTRAINT "current_game_player_stats_attempt_bounds_check" CHECK (
      "passing_completions" <= "passing_attempts" AND
      "receptions" <= "targets" AND
      "field_goals_made" <= "field_goals_attempted" AND
      "extra_points_made" <= "extra_points_attempted"
    )
);

CREATE UNIQUE INDEX "current_game_player_stats_game_player_key"
ON "current_game_player_stats"("game_id", "player_id");

CREATE INDEX "current_game_player_stats_game_team_idx"
ON "current_game_player_stats"("game_id", "team_id");

CREATE INDEX "current_game_player_stats_player_game_idx"
ON "current_game_player_stats"("player_id", "game_id");

ALTER TABLE "current_game_player_stats"
ADD CONSTRAINT "current_game_player_stats_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "current_game_player_stats"
ADD CONSTRAINT "current_game_player_stats_team_id_fkey"
FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "current_game_player_stats"
ADD CONSTRAINT "current_game_player_stats_player_id_fkey"
FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "current_game_player_stat_coverage" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider_rows" INTEGER NOT NULL,
    "resolved_rows" INTEGER NOT NULL,
    "unresolved_rows" INTEGER NOT NULL,
    "source_provider" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "current_game_player_stat_coverage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "current_game_player_stat_coverage_counts_check" CHECK (
      "provider_rows" >= 0 AND "resolved_rows" >= 0 AND "unresolved_rows" >= 0 AND
      "resolved_rows" + "unresolved_rows" = "provider_rows"
    )
);

CREATE UNIQUE INDEX "current_game_player_stat_coverage_game_key"
ON "current_game_player_stat_coverage"("game_id");

ALTER TABLE "current_game_player_stat_coverage"
ADD CONSTRAINT "current_game_player_stat_coverage_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
