-- CreateEnum
CREATE TYPE "GameSchedulingClass" AS ENUM ('NOT_DUE', 'PREGAME', 'LIVE_NORMAL', 'LIVE_FEATURED', 'HALFTIME', 'FINAL_IMMEDIATE', 'FINAL_RECONCILE_10', 'FINAL_RECONCILE_60', 'COMPLETE');

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "manual_featured" BOOLEAN,
ADD COLUMN     "manual_featured_at" TIMESTAMPTZ(3),
ADD COLUMN     "manual_featured_by_id" UUID,
ADD COLUMN     "manual_featured_reason" VARCHAR(500);

-- CreateTable
CREATE TABLE "current_game_poll_states" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "scheduling_class" "GameSchedulingClass" NOT NULL DEFAULT 'NOT_DUE',
    "featured_reason" VARCHAR(32),
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "next_poll_at" TIMESTAMPTZ(3),
    "last_observed_status" "GameStatus",
    "last_error" VARCHAR(500),
    "final_observed_at" TIMESTAMPTZ(3),
    "final_immediate_completed_at" TIMESTAMPTZ(3),
    "final_10_completed_at" TIMESTAMPTZ(3),
    "final_60_completed_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "current_game_poll_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "current_game_poll_states_game_id_key" ON "current_game_poll_states"("game_id");

-- CreateIndex
CREATE INDEX "current_game_poll_states_next_poll_idx" ON "current_game_poll_states"("next_poll_at");

-- CreateIndex
CREATE INDEX "current_game_poll_states_class_next_poll_idx" ON "current_game_poll_states"("scheduling_class", "next_poll_at");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_manual_featured_by_id_fkey" FOREIGN KEY ("manual_featured_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "current_game_poll_states" ADD CONSTRAINT "current_game_poll_states_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
