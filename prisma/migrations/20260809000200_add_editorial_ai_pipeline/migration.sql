CREATE TYPE "EditorialAiConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "EditorialAiReviewStatus" AS ENUM ('NEEDS_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "EditorialCategory" AS ENUM ('BREAKING_NEWS', 'TRAINING_CAMP', 'PRESEASON', 'GAME', 'INJURY', 'TRANSACTION', 'CONTRACT', 'ROSTER', 'TRADE', 'PLAYER', 'TEAM', 'ANALYSIS', 'FANTASY', 'LEAGUE', 'OFF_FIELD');
CREATE TYPE "EditorialRiskFlag" AS ENUM ('THIN_SOURCE', 'POSSIBLE_DUPLICATE', 'SENSITIVE_INJURY', 'CONTRACT_FIGURES', 'LEGAL_DISCIPLINARY', 'TRADE_RUMOR', 'UNSOURCED_CLAIM', 'QUOTE_INCLUDED', 'MEDIA_RIGHTS_UNCLEAR', 'PLAYER_IDENTITY_UNCERTAIN', 'SOURCE_OVERLAP');
CREATE TYPE "StoryOverlapStatus" AS ENUM ('UNIQUE', 'RELATED', 'LIKELY_DUPLICATE', 'DUPLICATE');
CREATE TYPE "SourceTextUsage" AS ENUM ('SUMMARY_ALLOWED', 'LINK_ONLY', 'UNKNOWN');
CREATE TYPE "SourceMediaUsage" AS ENUM ('OWNED', 'EMBED_ALLOWED', 'LINK_ONLY', 'UNKNOWN');
CREATE TYPE "SourceQuotationPolicy" AS ENUM ('SHORT_QUOTES_ONLY', 'UNKNOWN');
CREATE TYPE "ArticleMediaType" AS ENUM ('YOUTUBE', 'VIDEO_EMBED', 'IMAGE', 'EXTERNAL_LINK');
CREATE TYPE "ArticleMediaStatus" AS ENUM ('SUGGESTED', 'ATTACHED', 'REJECTED');

CREATE TABLE "article_players" (
  "article_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_players_pkey" PRIMARY KEY ("article_id", "player_id")
);

CREATE TABLE "source_rights_profiles" (
  "id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "text_usage" "SourceTextUsage" NOT NULL DEFAULT 'UNKNOWN',
  "image_usage" "SourceMediaUsage" NOT NULL DEFAULT 'UNKNOWN',
  "video_usage" "SourceMediaUsage" NOT NULL DEFAULT 'UNKNOWN',
  "quotation_policy" "SourceQuotationPolicy" NOT NULL DEFAULT 'UNKNOWN',
  "review_required" BOOLEAN NOT NULL DEFAULT true,
  "notes" VARCHAR(1000),
  "reviewed_by_id" UUID,
  "reviewed_by_snapshot" VARCHAR(254),
  "reviewed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "source_rights_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "article_ai_metadata" (
  "id" UUID NOT NULL,
  "article_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "model" VARCHAR(128) NOT NULL,
  "prompt_version" VARCHAR(64) NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "confidence" "EditorialAiConfidence" NOT NULL,
  "risk_flags" "EditorialRiskFlag"[] NOT NULL,
  "category" "EditorialCategory" NOT NULL,
  "topic_tags" TEXT[] NOT NULL,
  "media_search_terms" TEXT[] NOT NULL,
  "review_status" "EditorialAiReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "primary_team_id" UUID,
  "unresolved_entities" JSONB NOT NULL,
  "overlap_status" "StoryOverlapStatus" NOT NULL,
  "closest_candidate_id" UUID,
  "closest_article_id" UUID,
  "duplicate_score" DOUBLE PRECISION,
  "source_overlap_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "estimated_cost_micros" INTEGER,
  "source_preparation_ms" INTEGER NOT NULL,
  "ai_duration_ms" INTEGER NOT NULL,
  "entity_resolution_ms" INTEGER NOT NULL,
  "duplicate_detection_ms" INTEGER NOT NULL,
  "database_duration_ms" INTEGER NOT NULL,
  "total_duration_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "article_ai_metadata_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "article_media_candidates" (
  "id" UUID NOT NULL,
  "article_id" UUID NOT NULL,
  "candidate_id" UUID,
  "type" "ArticleMediaType" NOT NULL,
  "platform" VARCHAR(64) NOT NULL,
  "external_id" VARCHAR(256),
  "url" TEXT NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "publisher" VARCHAR(160),
  "thumbnail_url" TEXT,
  "published_at" TIMESTAMPTZ(3),
  "embed_allowed" BOOLEAN NOT NULL DEFAULT false,
  "rights_status" "SourceMediaUsage" NOT NULL DEFAULT 'UNKNOWN',
  "relevance_score" DOUBLE PRECISION NOT NULL,
  "status" "ArticleMediaStatus" NOT NULL DEFAULT 'SUGGESTED',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "article_media_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_rights_profiles_source_key" ON "source_rights_profiles"("source_id");
CREATE INDEX "source_rights_profiles_reviewer_idx" ON "source_rights_profiles"("reviewed_by_id");
CREATE UNIQUE INDEX "article_ai_metadata_article_key" ON "article_ai_metadata"("article_id");
CREATE UNIQUE INDEX "article_ai_metadata_candidate_key" ON "article_ai_metadata"("candidate_id");
CREATE INDEX "article_ai_metadata_review_idx" ON "article_ai_metadata"("review_status", "generated_at", "id");
CREATE INDEX "article_ai_metadata_primary_team_idx" ON "article_ai_metadata"("primary_team_id", "review_status");
CREATE INDEX "article_ai_metadata_overlap_idx" ON "article_ai_metadata"("overlap_status", "generated_at");
CREATE UNIQUE INDEX "article_media_candidates_external_key" ON "article_media_candidates"("article_id", "platform", "external_id");
CREATE INDEX "article_media_candidates_article_status_idx" ON "article_media_candidates"("article_id", "status", "relevance_score");
CREATE INDEX "article_media_candidates_candidate_idx" ON "article_media_candidates"("candidate_id");
CREATE INDEX "article_players_player_article_idx" ON "article_players"("player_id", "article_id");

ALTER TABLE "article_players" ADD CONSTRAINT "article_players_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_players" ADD CONSTRAINT "article_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_rights_profiles" ADD CONSTRAINT "source_rights_profiles_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_rights_profiles" ADD CONSTRAINT "source_rights_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "article_ai_metadata" ADD CONSTRAINT "article_ai_metadata_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_ai_metadata" ADD CONSTRAINT "article_ai_metadata_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "news_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "article_ai_metadata" ADD CONSTRAINT "article_ai_metadata_primary_team_id_fkey" FOREIGN KEY ("primary_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "article_media_candidates" ADD CONSTRAINT "article_media_candidates_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_media_candidates" ADD CONSTRAINT "article_media_candidates_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "news_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
