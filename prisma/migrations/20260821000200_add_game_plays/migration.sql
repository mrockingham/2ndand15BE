CREATE TYPE "GamePlayType" AS ENUM (
  'PASS',
  'RUSH',
  'PUNT',
  'KICKOFF',
  'FIELD_GOAL',
  'SACK',
  'PENALTY',
  'TIMEOUT',
  'INTERCEPTION',
  'FUMBLE',
  'END_PERIOD',
  'OTHER'
);

CREATE TABLE "game_plays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "game_id" UUID NOT NULL,
  "play_key" CHAR(64) NOT NULL,
  "reconciliation_key" CHAR(64) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "period" INTEGER NOT NULL,
  "clock" VARCHAR(8) NOT NULL,
  "possession_team_id" UUID,
  "play_type" "GamePlayType" NOT NULL,
  "description" TEXT NOT NULL,
  "start_down" INTEGER,
  "start_distance" INTEGER,
  "start_yard_line" INTEGER,
  "end_down" INTEGER,
  "end_distance" INTEGER,
  "end_yard_line" INTEGER,
  "is_scoring_play" BOOLEAN NOT NULL,
  "is_penalty" BOOLEAN NOT NULL,
  "is_turnover" BOOLEAN NOT NULL,
  "source_provider" VARCHAR(64) NOT NULL,
  "source_play_type" VARCHAR(128) NOT NULL,
  "source_updated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "game_plays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "game_plays_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "game_plays_period_check" CHECK ("period" BETWEEN 1 AND 10),
  CONSTRAINT "game_plays_start_down_check" CHECK ("start_down" IS NULL OR "start_down" BETWEEN 1 AND 4),
  CONSTRAINT "game_plays_end_down_check" CHECK ("end_down" IS NULL OR "end_down" BETWEEN 1 AND 4),
  CONSTRAINT "game_plays_start_distance_check" CHECK ("start_distance" IS NULL OR "start_distance" BETWEEN 0 AND 100),
  CONSTRAINT "game_plays_end_distance_check" CHECK ("end_distance" IS NULL OR "end_distance" BETWEEN 0 AND 100),
  CONSTRAINT "game_plays_start_yard_line_check" CHECK ("start_yard_line" IS NULL OR "start_yard_line" BETWEEN 0 AND 100),
  CONSTRAINT "game_plays_end_yard_line_check" CHECK ("end_yard_line" IS NULL OR "end_yard_line" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "game_plays_game_play_key" ON "game_plays"("game_id", "play_key");
CREATE UNIQUE INDEX "game_plays_game_sequence_key" ON "game_plays"("game_id", "sequence");
CREATE INDEX "game_plays_game_period_sequence_idx" ON "game_plays"("game_id", "period", "sequence");
CREATE INDEX "game_plays_game_reconciliation_idx" ON "game_plays"("game_id", "reconciliation_key");

ALTER TABLE "game_plays"
  ADD CONSTRAINT "game_plays_game_id_fkey"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_plays"
  ADD CONSTRAINT "game_plays_possession_team_id_fkey"
  FOREIGN KEY ("possession_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
