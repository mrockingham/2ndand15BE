-- AlterTable
ALTER TABLE "game_plays" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "game_data_health_probes" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "request_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "provider_reachable" BOOLEAN NOT NULL,
    "provider_match_found" BOOLEAN NOT NULL,
    "quota_limit" INTEGER,
    "quota_remaining" INTEGER,
    "result_diagnosis" VARCHAR(64) NOT NULL,
    "team_stats_diagnosis" VARCHAR(64) NOT NULL,
    "player_stats_diagnosis" VARCHAR(64) NOT NULL,
    "plays_diagnosis" VARCHAR(64) NOT NULL,
    "provider_team_stat_rows" INTEGER,
    "db_team_stat_rows" INTEGER,
    "provider_player_stat_rows" INTEGER,
    "normalized_player_stat_rows" INTEGER,
    "resolved_player_count" INTEGER,
    "unresolved_player_count" INTEGER,
    "db_player_stat_rows" INTEGER,
    "provider_play_count" INTEGER,
    "db_play_count" INTEGER,
    "error_code" VARCHAR(64),

    CONSTRAINT "game_data_health_probes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_data_health_probes_game_checked_idx" ON "game_data_health_probes"("game_id", "checked_at");

-- RenameForeignKey
ALTER TABLE "candidate_quality_evaluations" RENAME CONSTRAINT "candidate_quality_candidate_fkey" TO "candidate_quality_evaluations_candidate_id_fkey";

-- RenameForeignKey
ALTER TABLE "candidate_quality_evaluations" RENAME CONSTRAINT "candidate_quality_evaluator_fkey" TO "candidate_quality_evaluations_evaluated_by_id_fkey";

-- AddForeignKey
ALTER TABLE "game_data_health_probes" ADD CONSTRAINT "game_data_health_probes_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
