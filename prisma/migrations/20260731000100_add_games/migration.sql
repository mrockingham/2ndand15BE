-- CreateEnum
CREATE TYPE "SeasonType" AS ENUM ('PRE', 'REG', 'POST');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('SCHEDULED', 'PREGAME', 'IN_PROGRESS', 'HALFTIME', 'FINAL', 'POSTPONED', 'CANCELED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "league" "League" NOT NULL,
    "season" INTEGER NOT NULL,
    "season_type" "SeasonType" NOT NULL,
    "week" INTEGER,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "status" "GameStatus" NOT NULL,
    "home_team_id" UUID NOT NULL,
    "away_team_id" UUID NOT NULL,
    "home_score" INTEGER,
    "away_score" INTEGER,
    "quarter" INTEGER,
    "clock" VARCHAR(16),
    "venue_name" VARCHAR(160),
    "venue_city" VARCHAR(128),
    "broadcast_network" VARCHAR(64),
    "is_neutral_site" BOOLEAN NOT NULL DEFAULT false,
    "provider_last_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "games_distinct_teams_check" CHECK ("home_team_id" <> "away_team_id"),
    CONSTRAINT "games_nonnegative_scores_check" CHECK (("home_score" IS NULL OR "home_score" >= 0) AND ("away_score" IS NULL OR "away_score" >= 0)),
    CONSTRAINT "games_scores_pair_check" CHECK (("home_score" IS NULL) = ("away_score" IS NULL)),
    CONSTRAINT "games_week_check" CHECK ("week" IS NULL OR "week" BETWEEN 1 AND 22),
    CONSTRAINT "games_quarter_check" CHECK ("quarter" IS NULL OR "quarter" BETWEEN 1 AND 10)
);

-- CreateTable
CREATE TABLE "game_provider_mappings" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_game_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "games_schedule_idx" ON "games"("league", "season", "season_type", "week", "start_time");
CREATE INDEX "games_status_start_time_idx" ON "games"("status", "start_time");
CREATE INDEX "games_home_team_start_time_idx" ON "games"("home_team_id", "start_time");
CREATE INDEX "games_away_team_start_time_idx" ON "games"("away_team_id", "start_time");
CREATE UNIQUE INDEX "game_provider_mappings_provider_id_key" ON "game_provider_mappings"("provider", "provider_game_id");
CREATE UNIQUE INDEX "game_provider_mappings_game_provider_key" ON "game_provider_mappings"("game_id", "provider");
CREATE INDEX "game_provider_mappings_game_id_idx" ON "game_provider_mappings"("game_id");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_provider_mappings" ADD CONSTRAINT "game_provider_mappings_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
