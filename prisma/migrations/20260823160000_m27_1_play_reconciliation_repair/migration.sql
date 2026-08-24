-- M27.1: operator review + repair path for blocked GamePlay reconciliation.
--
-- IMPORTANT: this migration converts the two GamePlay identity constraints from full unique
-- constraints into PARTIAL unique indexes scoped to `WHERE superseded_at IS NULL`. Prisma's
-- schema DSL cannot express a partial predicate, so schema.prisma only shows these as plain
-- @@index — the real uniqueness guarantee lives entirely in this hand-authored SQL and will
-- never show up in `prisma migrate diff`/`prisma migrate status` drift detection.
--
-- DO NOT reintroduce `@@unique([gameId, playKey])` / `@@unique([gameId, sequence])` in
-- schema.prisma, and do not let a future migration silently replace these partial indexes with
-- full unique constraints. Doing so would reject every legitimate non-destructive repair write,
-- since an active row and its superseded predecessor are expected to share a playKey/sequence —
-- that is the entire mechanism the repair feature depends on. See the verification steps in
-- docs/current-season-games/play-reconciliation-review.md before/after applying this migration.

-- AlterTable: non-destructive supersede columns on game_plays
ALTER TABLE "game_plays" ADD COLUMN "superseded_at" TIMESTAMPTZ(3);
ALTER TABLE "game_plays" ADD COLUMN "superseded_by_run_id" UUID;

-- DropIndex: the two full unique constraints being replaced by partial unique indexes below
DROP INDEX "game_plays_game_play_key";
DROP INDEX "game_plays_game_sequence_key";

-- CreateIndex: plain (non-unique) indexes for query planning, matching schema.prisma's @@index
CREATE INDEX "game_plays_game_play_key_idx" ON "game_plays"("game_id", "play_key");
CREATE INDEX "game_plays_game_sequence_idx" ON "game_plays"("game_id", "sequence");
CREATE INDEX "game_plays_superseded_by_run_id_idx" ON "game_plays"("superseded_by_run_id") WHERE "superseded_by_run_id" IS NOT NULL;

-- CreateIndex: the real uniqueness guarantee, scoped to currently-active (non-superseded) rows.
-- See the warning at the top of this file — never convert these into Prisma @@unique.
CREATE UNIQUE INDEX "game_plays_active_game_play_key" ON "game_plays"("game_id", "play_key") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "game_plays_active_game_sequence_key" ON "game_plays"("game_id", "sequence") WHERE "superseded_at" IS NULL;

-- AlterTable: durable plays-block visibility on current_game_poll_states
ALTER TABLE "current_game_poll_states" ADD COLUMN "plays_blocked_at" TIMESTAMPTZ(3);
ALTER TABLE "current_game_poll_states" ADD COLUMN "plays_block_reason" VARCHAR(64);
ALTER TABLE "current_game_poll_states" ADD COLUMN "plays_review_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "current_game_poll_states_plays_review_idx" ON "current_game_poll_states"("plays_review_required");
