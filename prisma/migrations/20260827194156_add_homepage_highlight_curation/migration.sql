-- CreateEnum
CREATE TYPE "HomepageHighlightSourceType" AS ENUM ('GAME_HIGHLIGHT', 'CURATED_GAME_VIDEO');

-- CreateTable
CREATE TABLE "homepage_highlight_placements" (
    "id" UUID NOT NULL,
    "source_type" "HomepageHighlightSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_highlight_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_highlight_settings" (
    "id" UUID NOT NULL,
    "display_limit" INTEGER NOT NULL DEFAULT 5,
    "fill_with_automatic" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_highlight_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "homepage_highlight_placements_game_id_idx" ON "homepage_highlight_placements"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_highlight_placements_source_key" ON "homepage_highlight_placements"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_highlight_placements_position_key" ON "homepage_highlight_placements"("position");

-- AddForeignKey
ALTER TABLE "homepage_highlight_placements" ADD CONSTRAINT "homepage_highlight_placements_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_highlight_placements" ADD CONSTRAINT "homepage_highlight_placements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_highlight_placements" ADD CONSTRAINT "homepage_highlight_placements_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_highlight_settings" ADD CONSTRAINT "homepage_highlight_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

