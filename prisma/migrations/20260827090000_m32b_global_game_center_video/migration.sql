-- CreateTable
CREATE TABLE "global_game_center_videos" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "embed_url" TEXT NOT NULL,
    "canonical_url" TEXT,
    "thumbnail_url" TEXT,
    "source_label" VARCHAR(80),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "global_game_center_videos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "global_game_center_videos" ADD CONSTRAINT "global_game_center_videos_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_game_center_videos" ADD CONSTRAINT "global_game_center_videos_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
