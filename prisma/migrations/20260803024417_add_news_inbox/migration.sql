-- CreateEnum
CREATE TYPE "NewsSourceKind" AS ENUM ('RSS', 'ATOM', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "NewsSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "NewsCandidateStatus" AS ENUM ('NEW', 'REVIEWING', 'SAVED', 'CONVERTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NewsIngestionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "news_sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "kind" "NewsSourceKind" NOT NULL,
    "status" "NewsSourceStatus" NOT NULL DEFAULT 'PAUSED',
    "feed_url" TEXT,
    "site_url" TEXT NOT NULL,
    "publisher_name" VARCHAR(160) NOT NULL,
    "default_team_id" UUID,
    "is_official_league" BOOLEAN NOT NULL DEFAULT false,
    "is_official_team" BOOLEAN NOT NULL DEFAULT false,
    "allows_description_use" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1000),
    "last_checked_at" TIMESTAMPTZ(3),
    "last_successful_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(96),
    "last_error_summary" VARCHAR(500),
    "last_item_count" INTEGER NOT NULL DEFAULT 0,
    "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
    "response_etag" VARCHAR(512),
    "response_modified" VARCHAR(256),
    "ingestion_lease_id" UUID,
    "ingestion_lease_started_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "news_sources_kind_feed_url_check" CHECK (
      ("kind" = 'MANUAL_ONLY' AND "feed_url" IS NULL) OR
      ("kind" IN ('RSS', 'ATOM') AND "feed_url" IS NOT NULL)
    ),
    CONSTRAINT "news_sources_urls_check" CHECK (
      "site_url" ~* '^https?://' AND ("feed_url" IS NULL OR "feed_url" ~* '^https?://')
    ),
    CONSTRAINT "news_sources_lease_pair_check" CHECK (
      ("ingestion_lease_id" IS NULL) = ("ingestion_lease_started_at" IS NULL)
    ),
    CONSTRAINT "news_sources_health_counts_check" CHECK (
      "last_item_count" >= 0 AND "consecutive_failure_count" >= 0
    )
);

-- CreateTable
CREATE TABLE "news_candidates" (
    "id" UUID NOT NULL,
    "source_id" UUID,
    "source_name_snapshot" VARCHAR(160) NOT NULL,
    "source_external_id" VARCHAR(512),
    "canonical_url" TEXT NOT NULL,
    "canonical_url_hash" CHAR(64) NOT NULL,
    "headline" VARCHAR(300) NOT NULL,
    "source_description" VARCHAR(2000),
    "source_author" VARCHAR(160),
    "source_published_at" TIMESTAMPTZ(3),
    "discovered_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "NewsCandidateStatus" NOT NULL DEFAULT 'NEW',
    "dismissal_reason" VARCHAR(500),
    "converted_article_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_by_snapshot" VARCHAR(254),
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "news_candidates_url_check" CHECK ("canonical_url" ~* '^https?://'),
    CONSTRAINT "news_candidates_dismissal_check" CHECK (
      ("status" = 'DISMISSED' AND "dismissal_reason" IS NOT NULL) OR
      ("status" <> 'DISMISSED' AND "dismissal_reason" IS NULL)
    ),
    CONSTRAINT "news_candidates_conversion_check" CHECK (
      ("status" = 'CONVERTED' AND "converted_article_id" IS NOT NULL) OR
      ("status" <> 'CONVERTED' AND "converted_article_id" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "news_candidate_teams" (
    "candidate_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "rule" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_candidate_teams_pkey" PRIMARY KEY ("candidate_id","team_id")
);

-- CreateTable
CREATE TABLE "news_ingestion_runs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "status" "NewsIngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "response_bytes" INTEGER,
    "response_etag" VARCHAR(512),
    "response_modified" VARCHAR(256),
    "error_code" VARCHAR(96),
    "error_summary" VARCHAR(500),
    "initiated_by_id" UUID,
    "initiated_by_snapshot" VARCHAR(254) NOT NULL,
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_ingestion_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "news_ingestion_runs_counts_check" CHECK (
      "fetched_count" >= 0 AND "created_count" >= 0 AND "updated_count" >= 0 AND
      "skipped_count" >= 0 AND "failed_count" >= 0 AND
      ("response_bytes" IS NULL OR "response_bytes" >= 0)
    ),
    CONSTRAINT "news_ingestion_runs_completion_check" CHECK (
      ("status" = 'RUNNING' AND "completed_at" IS NULL) OR
      ("status" <> 'RUNNING' AND "completed_at" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "news_sources_slug_key" ON "news_sources"("slug");

-- CreateIndex
CREATE INDEX "news_sources_status_name_idx" ON "news_sources"("status", "name", "id");

-- CreateIndex
CREATE INDEX "news_sources_default_team_idx" ON "news_sources"("default_team_id");

-- CreateIndex
CREATE INDEX "news_sources_created_by_idx" ON "news_sources"("created_by_id");

-- CreateIndex
CREATE INDEX "news_sources_updated_by_idx" ON "news_sources"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "news_candidates_canonical_url_hash_key" ON "news_candidates"("canonical_url_hash");

-- CreateIndex
CREATE UNIQUE INDEX "news_candidates_converted_article_id_key" ON "news_candidates"("converted_article_id");

-- CreateIndex
CREATE INDEX "news_candidates_status_discovered_idx" ON "news_candidates"("status", "discovered_at", "id");

-- CreateIndex
CREATE INDEX "news_candidates_source_discovered_idx" ON "news_candidates"("source_id", "discovered_at", "id");

-- CreateIndex
CREATE INDEX "news_candidates_published_idx" ON "news_candidates"("source_published_at", "id");

-- CreateIndex
CREATE INDEX "news_candidates_reviewer_idx" ON "news_candidates"("reviewed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "news_candidates_source_external_id_key" ON "news_candidates"("source_id", "source_external_id");

-- CreateIndex
CREATE INDEX "news_candidate_teams_team_candidate_idx" ON "news_candidate_teams"("team_id", "candidate_id");

-- CreateIndex
CREATE INDEX "news_ingestion_runs_source_started_idx" ON "news_ingestion_runs"("source_id", "started_at", "id");

-- CreateIndex
CREATE INDEX "news_ingestion_runs_status_started_idx" ON "news_ingestion_runs"("status", "started_at", "id");

-- CreateIndex
CREATE INDEX "news_ingestion_runs_initiator_idx" ON "news_ingestion_runs"("initiated_by_id", "started_at");

-- AddForeignKey
ALTER TABLE "news_sources" ADD CONSTRAINT "news_sources_default_team_id_fkey" FOREIGN KEY ("default_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_sources" ADD CONSTRAINT "news_sources_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_sources" ADD CONSTRAINT "news_sources_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_candidates" ADD CONSTRAINT "news_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_candidates" ADD CONSTRAINT "news_candidates_converted_article_id_fkey" FOREIGN KEY ("converted_article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_candidates" ADD CONSTRAINT "news_candidates_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_candidate_teams" ADD CONSTRAINT "news_candidate_teams_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "news_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_candidate_teams" ADD CONSTRAINT "news_candidate_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_ingestion_runs" ADD CONSTRAINT "news_ingestion_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_ingestion_runs" ADD CONSTRAINT "news_ingestion_runs_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
