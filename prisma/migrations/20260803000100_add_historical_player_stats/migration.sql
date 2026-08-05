CREATE TYPE "HistoricalDatasetKind" AS ENUM ('PLAYERS', 'WEEKLY_ROSTERS', 'PLAYER_STATS', 'SCHEDULES');
CREATE TYPE "HistoricalImportStatus" AS ENUM ('RUNNING', 'DRY_RUN', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "PlayerSeasonSummaryType" AS ENUM ('REG', 'POST', 'REG_POST');

CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "normalized_name" VARCHAR(160) NOT NULL,
    "first_name" VARCHAR(80), "last_name" VARCHAR(80), "short_name" VARCHAR(80), "football_name" VARCHAR(80),
    "position" VARCHAR(16), "source_position" VARCHAR(32), "position_group" VARCHAR(24), "birth_date" DATE,
    "height_inches" INTEGER, "weight_pounds" INTEGER, "college" VARCHAR(160), "rookie_season" INTEGER, "last_season" INTEGER,
    "draft_year" INTEGER, "draft_round" INTEGER, "draft_pick" INTEGER, "draft_team_id" UUID, "draft_team_source" VARCHAR(16),
    "latest_team_id" UUID, "latest_team_source" VARCHAR(16), "jersey_number" INTEGER, "status" VARCHAR(32), "headshot_url" TEXT,
    "profile_source" VARCHAR(96) NOT NULL DEFAULT 'nflverse-players',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_external_identifiers" (
    "id" UUID NOT NULL, "player_id" UUID NOT NULL, "provider" VARCHAR(32) NOT NULL, "external_id" VARCHAR(128) NOT NULL,
    "source" VARCHAR(96) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "player_external_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_week_rosters" (
    "id" UUID NOT NULL, "player_id" UUID NOT NULL, "season" INTEGER NOT NULL, "week" INTEGER NOT NULL,
    "season_type" "SeasonType" NOT NULL, "team_id" UUID, "source_team" VARCHAR(16) NOT NULL, "position" VARCHAR(16),
    "source_position" VARCHAR(32), "depth_chart_position" VARCHAR(32), "jersey_number" INTEGER, "status" VARCHAR(32),
    "status_description" VARCHAR(32), "football_name" VARCHAR(80), "years_experience" INTEGER, "source_row_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "player_week_rosters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_game_stats" (
    "id" UUID NOT NULL, "player_id" UUID NOT NULL, "game_id" UUID NOT NULL, "team_id" UUID NOT NULL,
    "opponent_team_id" UUID NOT NULL, "season" INTEGER NOT NULL, "week" INTEGER NOT NULL, "season_type" "SeasonType" NOT NULL,
    "position" VARCHAR(16), "position_group" VARCHAR(24), "completions" INTEGER, "attempts" INTEGER,
    "passing_yards" INTEGER, "passing_touchdowns" INTEGER, "passing_interceptions" INTEGER, "sacks_suffered" INTEGER,
    "sack_yards_lost" INTEGER, "passing_air_yards" INTEGER, "passing_yards_after_catch" INTEGER, "passing_first_downs" INTEGER,
    "passing_epa" DOUBLE PRECISION, "passing_2pt_conversions" INTEGER, "carries" INTEGER, "rushing_yards" INTEGER,
    "rushing_touchdowns" INTEGER, "rushing_first_downs" INTEGER, "rushing_epa" DOUBLE PRECISION, "rushing_fumbles" INTEGER,
    "rushing_fumbles_lost" INTEGER, "rushing_2pt_conversions" INTEGER, "targets" INTEGER, "receptions" INTEGER,
    "receiving_yards" INTEGER, "receiving_touchdowns" INTEGER, "receiving_air_yards" INTEGER,
    "receiving_yards_after_catch" INTEGER, "receiving_first_downs" INTEGER, "receiving_epa" DOUBLE PRECISION,
    "target_share" DOUBLE PRECISION, "receiving_2pt_conversions" INTEGER, "fumbles" INTEGER, "fumbles_lost" INTEGER,
    "tackles_solo" INTEGER, "tackles_with_assist" INTEGER, "tackle_assists" INTEGER, "tackles_for_loss" INTEGER,
    "defensive_sacks" DOUBLE PRECISION, "defensive_sack_yards" DOUBLE PRECISION, "quarterback_hits" INTEGER,
    "defensive_interceptions" INTEGER, "interception_yards" INTEGER, "passes_defended" INTEGER, "forced_fumbles" INTEGER,
    "fumble_recoveries" INTEGER, "defensive_touchdowns" INTEGER, "field_goals_made" INTEGER, "field_goals_attempted" INTEGER,
    "extra_points_made" INTEGER, "extra_points_attempted" INTEGER, "punts" INTEGER, "punt_yards" INTEGER,
    "punt_return_yards" INTEGER, "punt_return_touchdowns" INTEGER, "kickoff_return_yards" INTEGER,
    "special_teams_touchdowns" INTEGER, "fantasy_points_standard" DOUBLE PRECISION, "fantasy_points_ppr" DOUBLE PRECISION,
    "source_row_hash" CHAR(64) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "player_game_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "player_season_stats" (
    "id" UUID NOT NULL, "player_id" UUID NOT NULL, "season" INTEGER NOT NULL,
    "summary_type" "PlayerSeasonSummaryType" NOT NULL, "position" VARCHAR(16), "position_group" VARCHAR(24),
    "games" INTEGER NOT NULL, "team_count" INTEGER NOT NULL, "completions" INTEGER, "attempts" INTEGER,
    "passing_yards" INTEGER, "passing_touchdowns" INTEGER, "passing_interceptions" INTEGER, "carries" INTEGER,
    "rushing_yards" INTEGER, "rushing_touchdowns" INTEGER, "targets" INTEGER, "receptions" INTEGER,
    "receiving_yards" INTEGER, "receiving_touchdowns" INTEGER, "tackles_solo" INTEGER, "tackle_assists" INTEGER,
    "defensive_sacks" DOUBLE PRECISION, "defensive_interceptions" INTEGER, "forced_fumbles" INTEGER,
    "defensive_touchdowns" INTEGER, "field_goals_made" INTEGER, "field_goals_attempted" INTEGER,
    "extra_points_made" INTEGER, "extra_points_attempted" INTEGER, "punts" INTEGER, "punt_yards" INTEGER,
    "fantasy_points_standard" DOUBLE PRECISION, "fantasy_points_ppr" DOUBLE PRECISION,
    "aggregation_version" VARCHAR(32) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "player_season_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_datasets" (
    "id" UUID NOT NULL, "dataset" "HistoricalDatasetKind" NOT NULL, "season" INTEGER, "source_url" TEXT NOT NULL,
    "release_id" VARCHAR(96) NOT NULL, "schema_version" VARCHAR(64) NOT NULL, "mapping_version" VARCHAR(64) NOT NULL,
    "attribution" VARCHAR(500) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "historical_datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_import_runs" (
    "id" UUID NOT NULL, "status" "HistoricalImportStatus" NOT NULL DEFAULT 'RUNNING', "dry_run" BOOLEAN NOT NULL,
    "initiated_by" VARCHAR(160) NOT NULL, "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3), "database_size_before" BIGINT, "database_size_after" BIGINT, "summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "historical_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "historical_import_files" (
    "id" UUID NOT NULL, "run_id" UUID NOT NULL, "dataset_id" UUID NOT NULL,
    "status" "HistoricalImportStatus" NOT NULL DEFAULT 'RUNNING', "checksum_sha256" CHAR(64) NOT NULL,
    "file_size_bytes" BIGINT NOT NULL, "downloaded_at" TIMESTAMPTZ(3), "source_row_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_row_count" INTEGER NOT NULL DEFAULT 0, "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0, "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0, "failure_count" INTEGER NOT NULL DEFAULT 0,
    "schema_report" JSONB, "reconciliation" JSONB, "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3), CONSTRAINT "historical_import_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "players_normalized_name_idx" ON "players"("normalized_name", "id");
CREATE INDEX "players_position_idx" ON "players"("position_group", "position", "id");
CREATE INDEX "players_latest_team_idx" ON "players"("latest_team_id", "normalized_name", "id");
CREATE INDEX "player_external_ids_player_idx" ON "player_external_identifiers"("player_id");
CREATE UNIQUE INDEX "player_external_ids_provider_id_key" ON "player_external_identifiers"("provider", "external_id");
CREATE UNIQUE INDEX "player_external_ids_player_provider_key" ON "player_external_identifiers"("player_id", "provider");
CREATE INDEX "player_week_rosters_player_season_week_idx" ON "player_week_rosters"("player_id", "season", "week");
CREATE INDEX "player_week_rosters_team_season_week_idx" ON "player_week_rosters"("team_id", "season", "week");
CREATE UNIQUE INDEX "player_week_rosters_identity_key" ON "player_week_rosters"("player_id", "season", "week", "season_type", "source_team");
CREATE INDEX "player_game_stats_player_season_week_idx" ON "player_game_stats"("player_id", "season", "week");
CREATE INDEX "player_game_stats_game_idx" ON "player_game_stats"("game_id");
CREATE INDEX "player_game_stats_team_season_week_idx" ON "player_game_stats"("team_id", "season", "week");
CREATE INDEX "player_game_stats_season_position_idx" ON "player_game_stats"("season", "season_type", "position_group");
CREATE UNIQUE INDEX "player_game_stats_identity_key" ON "player_game_stats"("player_id", "game_id", "team_id");
CREATE INDEX "player_season_stats_season_position_idx" ON "player_season_stats"("season", "summary_type", "position_group");
CREATE INDEX "player_season_stats_passing_yards_idx" ON "player_season_stats"("season", "passing_yards");
CREATE INDEX "player_season_stats_rushing_yards_idx" ON "player_season_stats"("season", "rushing_yards");
CREATE INDEX "player_season_stats_receiving_yards_idx" ON "player_season_stats"("season", "receiving_yards");
CREATE UNIQUE INDEX "player_season_stats_identity_key" ON "player_season_stats"("player_id", "season", "summary_type");
CREATE UNIQUE INDEX "historical_datasets_identity_key" ON "historical_datasets"("dataset", "season", "release_id");
CREATE INDEX "historical_import_runs_status_started_idx" ON "historical_import_runs"("status", "started_at");
CREATE INDEX "historical_import_files_run_status_idx" ON "historical_import_files"("run_id", "status");
CREATE INDEX "historical_import_files_dataset_checksum_idx" ON "historical_import_files"("dataset_id", "checksum_sha256");
CREATE UNIQUE INDEX "historical_import_files_active_dataset_key" ON "historical_import_files"("dataset_id") WHERE "status" = 'RUNNING';

ALTER TABLE "players" ADD CONSTRAINT "players_draft_team_id_fkey" FOREIGN KEY ("draft_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "players" ADD CONSTRAINT "players_latest_team_id_fkey" FOREIGN KEY ("latest_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "player_external_identifiers" ADD CONSTRAINT "player_external_identifiers_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_week_rosters" ADD CONSTRAINT "player_week_rosters_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_week_rosters" ADD CONSTRAINT "player_week_rosters_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_opponent_team_id_fkey" FOREIGN KEY ("opponent_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "historical_import_files" ADD CONSTRAINT "historical_import_files_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "historical_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "historical_import_files" ADD CONSTRAINT "historical_import_files_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "historical_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "players" ADD CONSTRAINT "players_height_reasonable" CHECK ("height_inches" IS NULL OR "height_inches" BETWEEN 48 AND 96);
ALTER TABLE "players" ADD CONSTRAINT "players_weight_reasonable" CHECK ("weight_pounds" IS NULL OR "weight_pounds" BETWEEN 100 AND 500);
ALTER TABLE "player_week_rosters" ADD CONSTRAINT "player_week_rosters_week_valid" CHECK ("week" BETWEEN 1 AND 22);
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_week_valid" CHECK ("week" BETWEEN 1 AND 22);
