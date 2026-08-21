CREATE TYPE "PredictionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LOCKED', 'EVALUATED');
CREATE TYPE "PredictionConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "game_predictions" (
  "id" UUID NOT NULL,
  "game_id" UUID NOT NULL,
  "model_version" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "PredictionStatus" NOT NULL DEFAULT 'DRAFT',
  "home_team_id" UUID NOT NULL,
  "away_team_id" UUID NOT NULL,
  "predicted_winner_team_id" UUID,
  "home_win_probability" DOUBLE PRECISION NOT NULL,
  "away_win_probability" DOUBLE PRECISION NOT NULL,
  "projected_home_score" INTEGER,
  "projected_away_score" INTEGER,
  "confidence" "PredictionConfidence" NOT NULL,
  "factors" JSONB NOT NULL,
  "feature_snapshot" JSONB NOT NULL,
  "data_availability" JSONB NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "locked_at" TIMESTAMPTZ(3),
  "evaluated_at" TIMESTAMPTZ(3),
  "actual_home_score" INTEGER,
  "actual_away_score" INTEGER,
  "actual_winner_team_id" UUID,
  "was_correct" BOOLEAN,
  "brier_score" DOUBLE PRECISION,
  "is_tie" BOOLEAN,
  "is_retrospective" BOOLEAN NOT NULL DEFAULT false,
  "ai_summary" VARCHAR(1000),
  "ai_key_reasons" JSONB,
  "ai_watch_for" JSONB,
  "ai_provider" VARCHAR(64),
  "ai_model" VARCHAR(128),
  "ai_prompt_version" VARCHAR(64),
  "ai_input_tokens" INTEGER,
  "ai_output_tokens" INTEGER,
  "ai_duration_ms" INTEGER,
  "generated_by_id" UUID,
  "generated_by_snapshot" VARCHAR(254) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "game_predictions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "game_predictions_probability_check" CHECK ("home_win_probability" >= 0 AND "home_win_probability" <= 1 AND "away_win_probability" >= 0 AND "away_win_probability" <= 1 AND abs(("home_win_probability" + "away_win_probability") - 1) < 0.000001),
  CONSTRAINT "game_predictions_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "game_predictions_game_model_revision_key" ON "game_predictions"("game_id", "model_version", "revision");
CREATE INDEX "game_predictions_status_generated_idx" ON "game_predictions"("status", "generated_at");
CREATE INDEX "game_predictions_game_status_revision_idx" ON "game_predictions"("game_id", "status", "revision");
CREATE INDEX "game_predictions_teams_status_idx" ON "game_predictions"("home_team_id", "away_team_id", "status");

ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_predicted_winner_team_id_fkey" FOREIGN KEY ("predicted_winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_actual_winner_team_id_fkey" FOREIGN KEY ("actual_winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
