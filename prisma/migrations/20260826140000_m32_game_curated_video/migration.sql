-- CreateTable
CREATE TABLE "game_curated_videos" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "embed_url" TEXT NOT NULL,
    "canonical_url" TEXT,
    "thumbnail_url" TEXT,
    "source_label" VARCHAR(80),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_curated_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_curated_videos_game_position_key" ON "game_curated_videos"("game_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "game_curated_videos_game_embed_url_key" ON "game_curated_videos"("game_id", "embed_url");

-- CreateIndex
CREATE INDEX "game_curated_videos_game_id_idx" ON "game_curated_videos"("game_id");

-- AddForeignKey
ALTER TABLE "game_curated_videos" ADD CONSTRAINT "game_curated_videos_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_curated_videos" ADD CONSTRAINT "game_curated_videos_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_curated_videos" ADD CONSTRAINT "game_curated_videos_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
