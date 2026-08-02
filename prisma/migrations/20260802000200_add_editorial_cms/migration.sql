-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('ORIGINAL', 'CURATED', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "type" "ArticleType" NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(180) NOT NULL,
    "summary" VARCHAR(1000),
    "body" TEXT,
    "source_name" VARCHAR(160),
    "source_url" TEXT,
    "source_published_at" TIMESTAMPTZ(3),
    "hero_image_url" TEXT,
    "hero_image_alt" VARCHAR(300),
    "hero_image_attribution" VARCHAR(500),
    "hero_image_attribution_url" TEXT,
    "seo_title" VARCHAR(180),
    "seo_description" VARCHAR(320),
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "featured_priority" INTEGER,
    "featured_starts_at" TIMESTAMPTZ(3),
    "featured_ends_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "scheduled_for" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "articles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "articles_version_check" CHECK ("version" >= 1),
    CONSTRAINT "articles_featured_priority_check" CHECK ("featured_priority" IS NULL OR "featured_priority" BETWEEN 1 AND 1000),
    CONSTRAINT "articles_featured_window_check" CHECK ("featured_starts_at" IS NULL OR "featured_ends_at" IS NULL OR "featured_ends_at" > "featured_starts_at"),
    CONSTRAINT "articles_hero_alt_check" CHECK (("hero_image_url" IS NULL AND "hero_image_alt" IS NULL) OR ("hero_image_url" IS NOT NULL AND "hero_image_alt" IS NOT NULL)),
    CONSTRAINT "articles_source_url_protocol_check" CHECK ("source_url" IS NULL OR "source_url" ~* '^https?://'),
    CONSTRAINT "articles_hero_url_protocol_check" CHECK ("hero_image_url" IS NULL OR "hero_image_url" ~* '^https?://'),
    CONSTRAINT "articles_hero_attribution_url_protocol_check" CHECK ("hero_image_attribution_url" IS NULL OR "hero_image_attribution_url" ~* '^https?://'),
    CONSTRAINT "articles_body_size_check" CHECK ("body" IS NULL OR char_length("body") <= 100000),
    CONSTRAINT "articles_type_content_check" CHECK (
      ("type" = 'ORIGINAL' AND "summary" IS NOT NULL AND "body" IS NOT NULL) OR
      ("type" = 'CURATED' AND "summary" IS NOT NULL AND "source_name" IS NOT NULL AND "source_url" IS NOT NULL AND ("body" IS NULL OR char_length("body") <= 2000)) OR
      ("type" = 'ANNOUNCEMENT' AND "body" IS NOT NULL)
    ),
    CONSTRAINT "articles_status_time_check" CHECK (
      ("status" = 'SCHEDULED' AND "scheduled_for" IS NOT NULL) OR
      ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL) OR
      "status" IN ('DRAFT', 'UNPUBLISHED', 'ARCHIVED')
    )
);

-- CreateTable
CREATE TABLE "article_teams" (
    "article_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_teams_pkey" PRIMARY KEY ("article_id", "team_id")
);

-- CreateTable
CREATE TABLE "article_revisions" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "editor_user_id" UUID,
    "editor_snapshot" VARCHAR(254) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change_summary" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "article_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "article_revisions_number_check" CHECK ("revision_number" >= 1)
);

-- Indexes
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");
CREATE UNIQUE INDEX "articles_id_version_key" ON "articles"("id", "version");
CREATE INDEX "articles_status_published_idx" ON "articles"("status", "published_at", "id");
CREATE INDEX "articles_type_published_idx" ON "articles"("type", "published_at", "id");
CREATE INDEX "articles_featured_idx" ON "articles"("is_featured", "featured_priority", "published_at", "id");
CREATE INDEX "articles_scheduled_idx" ON "articles"("scheduled_for", "id");
CREATE INDEX "articles_creator_created_idx" ON "articles"("created_by_id", "created_at", "id");
CREATE INDEX "articles_updated_idx" ON "articles"("updated_at", "id");
CREATE INDEX "article_teams_team_article_idx" ON "article_teams"("team_id", "article_id");
CREATE UNIQUE INDEX "article_revisions_article_number_key" ON "article_revisions"("article_id", "revision_number");
CREATE INDEX "article_revisions_article_created_idx" ON "article_revisions"("article_id", "created_at", "id");
CREATE INDEX "article_revisions_editor_created_idx" ON "article_revisions"("editor_user_id", "created_at");

-- Foreign keys
ALTER TABLE "articles" ADD CONSTRAINT "articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "articles" ADD CONSTRAINT "articles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "article_teams" ADD CONSTRAINT "article_teams_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_teams" ADD CONSTRAINT "article_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_editor_user_id_fkey" FOREIGN KEY ("editor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
