-- CreateEnum
CREATE TYPE "HomepageHeroContentSlot" AS ENUM ('TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'MIDDLE_LEFT', 'MIDDLE_CENTER', 'MIDDLE_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT');

-- CreateEnum
CREATE TYPE "HomepageHeroCtaVariant" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateTable
CREATE TABLE "homepage_hero_slides" (
    "id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT NOT NULL,
    "image_alt" VARCHAR(300),
    "image_brightness" INTEGER NOT NULL DEFAULT 100,
    "image_contrast" INTEGER NOT NULL DEFAULT 100,
    "image_saturation" INTEGER NOT NULL DEFAULT 100,
    "overlay_opacity" INTEGER NOT NULL DEFAULT 0,
    "focal_point_x" INTEGER NOT NULL DEFAULT 50,
    "focal_point_y" INTEGER NOT NULL DEFAULT 50,
    "image_scale" INTEGER NOT NULL DEFAULT 100,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_hero_slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_hero_content_blocks" (
    "id" UUID NOT NULL,
    "hero_slide_id" UUID NOT NULL,
    "slot" "HomepageHeroContentSlot" NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_hero_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_hero_ctas" (
    "id" UUID NOT NULL,
    "hero_slide_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "url" TEXT NOT NULL,
    "variant" "HomepageHeroCtaVariant" NOT NULL DEFAULT 'PRIMARY',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_hero_ctas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_top_stories" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_top_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "homepage_hero_slides_position_key" ON "homepage_hero_slides"("position");

-- CreateIndex
CREATE INDEX "homepage_hero_content_blocks_slide_id_idx" ON "homepage_hero_content_blocks"("hero_slide_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_hero_content_blocks_slide_slot_key" ON "homepage_hero_content_blocks"("hero_slide_id", "slot");

-- CreateIndex
CREATE INDEX "homepage_hero_ctas_slide_id_idx" ON "homepage_hero_ctas"("hero_slide_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_hero_ctas_slide_position_key" ON "homepage_hero_ctas"("hero_slide_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_top_stories_article_id_key" ON "homepage_top_stories"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_top_stories_position_key" ON "homepage_top_stories"("position");

-- AddForeignKey
ALTER TABLE "homepage_hero_slides" ADD CONSTRAINT "homepage_hero_slides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_hero_slides" ADD CONSTRAINT "homepage_hero_slides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_hero_content_blocks" ADD CONSTRAINT "homepage_hero_content_blocks_hero_slide_id_fkey" FOREIGN KEY ("hero_slide_id") REFERENCES "homepage_hero_slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_hero_ctas" ADD CONSTRAINT "homepage_hero_ctas_hero_slide_id_fkey" FOREIGN KEY ("hero_slide_id") REFERENCES "homepage_hero_slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_top_stories" ADD CONSTRAINT "homepage_top_stories_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_top_stories" ADD CONSTRAINT "homepage_top_stories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homepage_top_stories" ADD CONSTRAINT "homepage_top_stories_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
