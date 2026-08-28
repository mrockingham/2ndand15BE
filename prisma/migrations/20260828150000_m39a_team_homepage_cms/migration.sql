CREATE TYPE "TeamHomepageEditorialSourceType" AS ENUM ('ARTICLE', 'VIDEO');

CREATE TABLE "team_homepage_configs" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "banner_image_url" TEXT,
  "banner_focal_x" INTEGER NOT NULL DEFAULT 50,
  "banner_focal_y" INTEGER NOT NULL DEFAULT 50,
  "banner_overlay_opacity" INTEGER NOT NULL DEFAULT 35,
  "updated_by_id" UUID,
  "updated_by_snapshot" VARCHAR(254) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "team_homepage_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_homepage_configs_banner_focal_x_check" CHECK ("banner_focal_x" BETWEEN 0 AND 100),
  CONSTRAINT "team_homepage_configs_banner_focal_y_check" CHECK ("banner_focal_y" BETWEEN 0 AND 100),
  CONSTRAINT "team_homepage_configs_overlay_check" CHECK ("banner_overlay_opacity" BETWEEN 0 AND 100)
);

CREATE TABLE "team_homepage_editorial_placements" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "source_type" "TeamHomepageEditorialSourceType" NOT NULL,
  "source_id" UUID NOT NULL,
  "media_source_type" "HomepageHighlightSourceType",
  "game_id" UUID,
  "position" INTEGER NOT NULL,
  "is_lead_replacement" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_by_snapshot" VARCHAR(254) NOT NULL,
  "updated_by_snapshot" VARCHAR(254) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "team_homepage_editorial_placements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_homepage_editorial_position_check" CHECK ("position" >= 0),
  CONSTRAINT "team_homepage_editorial_source_shape_check" CHECK (
    ("source_type" = 'ARTICLE' AND "media_source_type" IS NULL AND "game_id" IS NULL AND "is_lead_replacement" = false)
    OR
    ("source_type" = 'VIDEO' AND "media_source_type" IS NOT NULL AND "game_id" IS NOT NULL)
  )
);

CREATE TABLE "team_homepage_highlight_placements" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
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
  CONSTRAINT "team_homepage_highlight_placements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_homepage_highlight_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "team_homepage_highlight_settings" (
  "id" UUID NOT NULL,
  "team_id" UUID NOT NULL,
  "display_limit" INTEGER NOT NULL DEFAULT 5,
  "fill_with_automatic" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id" UUID,
  "updated_by_snapshot" VARCHAR(254) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "team_homepage_highlight_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_homepage_highlight_settings_limit_check" CHECK ("display_limit" BETWEEN 3 AND 10)
);

CREATE UNIQUE INDEX "team_homepage_configs_team_key" ON "team_homepage_configs"("team_id");
CREATE INDEX "team_homepage_editorial_source_idx" ON "team_homepage_editorial_placements"("team_id", "source_type", "source_id");
CREATE UNIQUE INDEX "team_homepage_editorial_article_source_key" ON "team_homepage_editorial_placements"("team_id", "source_id") WHERE "source_type" = 'ARTICLE';
CREATE UNIQUE INDEX "team_homepage_editorial_video_source_key" ON "team_homepage_editorial_placements"("team_id", "media_source_type", "source_id") WHERE "source_type" = 'VIDEO';
CREATE UNIQUE INDEX "team_homepage_editorial_position_key" ON "team_homepage_editorial_placements"("team_id", "position");
CREATE INDEX "team_homepage_editorial_game_id_idx" ON "team_homepage_editorial_placements"("game_id");
CREATE UNIQUE INDEX "team_homepage_editorial_one_lead_video_key" ON "team_homepage_editorial_placements"("team_id") WHERE "is_lead_replacement" = true;
CREATE UNIQUE INDEX "team_homepage_highlight_source_key" ON "team_homepage_highlight_placements"("team_id", "source_type", "source_id");
CREATE UNIQUE INDEX "team_homepage_highlight_position_key" ON "team_homepage_highlight_placements"("team_id", "position");
CREATE INDEX "team_homepage_highlight_game_id_idx" ON "team_homepage_highlight_placements"("game_id");
CREATE UNIQUE INDEX "team_homepage_highlight_settings_team_key" ON "team_homepage_highlight_settings"("team_id");

ALTER TABLE "team_homepage_configs" ADD CONSTRAINT "team_homepage_configs_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_configs" ADD CONSTRAINT "team_homepage_configs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_homepage_editorial_placements" ADD CONSTRAINT "team_homepage_editorial_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_editorial_placements" ADD CONSTRAINT "team_homepage_editorial_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_editorial_placements" ADD CONSTRAINT "team_homepage_editorial_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_homepage_editorial_placements" ADD CONSTRAINT "team_homepage_editorial_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_placements" ADD CONSTRAINT "team_homepage_highlight_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_placements" ADD CONSTRAINT "team_homepage_highlight_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_placements" ADD CONSTRAINT "team_homepage_highlight_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_placements" ADD CONSTRAINT "team_homepage_highlight_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_settings" ADD CONSTRAINT "team_homepage_highlight_settings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_homepage_highlight_settings" ADD CONSTRAINT "team_homepage_highlight_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
