CREATE TABLE "current_game_team_stats" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "is_home" BOOLEAN NOT NULL,
    "first_downs" INTEGER,
    "first_downs_passing" INTEGER,
    "first_downs_rushing" INTEGER,
    "first_downs_penalty" INTEGER,
    "total_plays" INTEGER,
    "total_yards" INTEGER,
    "passing_completions" INTEGER,
    "passing_attempts" INTEGER,
    "passing_yards" INTEGER,
    "passing_interceptions" INTEGER,
    "rushing_attempts" INTEGER,
    "rushing_yards" INTEGER,
    "turnovers" INTEGER,
    "fumbles_lost" INTEGER,
    "sacks" INTEGER,
    "sack_yards_lost" INTEGER,
    "third_down_conversions" INTEGER,
    "third_down_attempts" INTEGER,
    "fourth_down_conversions" INTEGER,
    "fourth_down_attempts" INTEGER,
    "penalties" INTEGER,
    "penalty_yards" INTEGER,
    "possession_seconds" INTEGER,
    "red_zone_conversions" INTEGER,
    "red_zone_attempts" INTEGER,
    "total_drives" INTEGER,
    "period_1_score" INTEGER,
    "period_2_score" INTEGER,
    "period_3_score" INTEGER,
    "period_4_score" INTEGER,
    "overtime_1_score" INTEGER,
    "overtime_2_score" INTEGER,
    "source_provider" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "current_game_team_stats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "current_game_team_stats_nonnegative_check" CHECK (
        "first_downs" >= 0 AND "first_downs_passing" >= 0 AND
        "first_downs_rushing" >= 0 AND "first_downs_penalty" >= 0 AND
        "total_plays" >= 0 AND "total_yards" >= 0 AND
        "passing_completions" >= 0 AND "passing_attempts" >= 0 AND
        "passing_yards" >= 0 AND "passing_interceptions" >= 0 AND
        "rushing_attempts" >= 0 AND "rushing_yards" >= 0 AND
        "turnovers" >= 0 AND "fumbles_lost" >= 0 AND "sacks" >= 0 AND
        "sack_yards_lost" >= 0 AND "third_down_conversions" >= 0 AND
        "third_down_attempts" >= 0 AND "fourth_down_conversions" >= 0 AND
        "fourth_down_attempts" >= 0 AND "penalties" >= 0 AND
        "penalty_yards" >= 0 AND "possession_seconds" >= 0 AND
        "red_zone_conversions" >= 0 AND "red_zone_attempts" >= 0 AND
        "total_drives" >= 0 AND "period_1_score" >= 0 AND
        "period_2_score" >= 0 AND "period_3_score" >= 0 AND
        "period_4_score" >= 0 AND "overtime_1_score" >= 0 AND
        "overtime_2_score" >= 0
    ),
    CONSTRAINT "current_game_team_stats_conversion_bounds_check" CHECK (
        "passing_completions" <= "passing_attempts" AND
        "third_down_conversions" <= "third_down_attempts" AND
        "fourth_down_conversions" <= "fourth_down_attempts" AND
        "red_zone_conversions" <= "red_zone_attempts"
    )
);

CREATE UNIQUE INDEX "current_game_team_stats_game_team_key"
ON "current_game_team_stats"("game_id", "team_id");

CREATE UNIQUE INDEX "current_game_team_stats_game_side_key"
ON "current_game_team_stats"("game_id", "is_home");

CREATE INDEX "current_game_team_stats_team_game_idx"
ON "current_game_team_stats"("team_id", "game_id");

ALTER TABLE "current_game_team_stats"
ADD CONSTRAINT "current_game_team_stats_game_id_fkey"
FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "current_game_team_stats"
ADD CONSTRAINT "current_game_team_stats_team_id_fkey"
FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
