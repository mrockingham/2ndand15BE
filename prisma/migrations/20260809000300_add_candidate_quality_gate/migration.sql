CREATE TYPE "CandidateRelevance" AS ENUM ('NFL', 'NOT_NFL', 'UNCERTAIN');
CREATE TYPE "CandidateSufficiency" AS ENUM ('FULL_DRAFT_ELIGIBLE', 'SHORT_BRIEF_ELIGIBLE', 'LINK_ONLY', 'INSUFFICIENT', 'MANUAL_REVIEW');
CREATE TYPE "CandidateQualityDecision" AS ENUM ('NFL_RELEVANT_FULL_DRAFT', 'NFL_RELEVANT_SHORT_BRIEF', 'NFL_RELEVANT_LINK_ONLY', 'REJECT_NON_NFL', 'REJECT_DUPLICATE', 'REJECT_INSUFFICIENT', 'NEEDS_MANUAL_REVIEW');

ALTER TABLE "news_sources"
  ADD COLUMN "reliability_weight" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "metadata_richness_weight" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "team_specificity_weight" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "editorial_usefulness_weight" INTEGER NOT NULL DEFAULT 50,
  ADD CONSTRAINT "news_sources_reliability_weight_check" CHECK ("reliability_weight" BETWEEN 0 AND 100),
  ADD CONSTRAINT "news_sources_metadata_richness_weight_check" CHECK ("metadata_richness_weight" BETWEEN 0 AND 100),
  ADD CONSTRAINT "news_sources_team_specificity_weight_check" CHECK ("team_specificity_weight" BETWEEN 0 AND 100),
  ADD CONSTRAINT "news_sources_editorial_usefulness_weight_check" CHECK ("editorial_usefulness_weight" BETWEEN 0 AND 100);

CREATE TABLE "candidate_quality_evaluations" (
  "id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "relevance" "CandidateRelevance" NOT NULL,
  "relevance_confidence" "EditorialAiConfidence" NOT NULL,
  "sufficiency" "CandidateSufficiency" NOT NULL,
  "decision" "CandidateQualityDecision" NOT NULL,
  "quality_score" INTEGER NOT NULL,
  "quality_factors" JSONB NOT NULL,
  "reasons" TEXT[] NOT NULL,
  "risk_flags" TEXT[] NOT NULL,
  "overlap_status" "StoryOverlapStatus" NOT NULL,
  "closest_candidate_id" UUID,
  "closest_article_id" UUID,
  "duplicate_score" DOUBLE PRECISION,
  "generation_eligible" BOOLEAN NOT NULL,
  "evaluated_by" VARCHAR(32) NOT NULL,
  "classifier_provider" VARCHAR(64),
  "classifier_model" VARCHAR(128),
  "classification_input_tokens" INTEGER,
  "classification_output_tokens" INTEGER,
  "classification_duration_ms" INTEGER NOT NULL DEFAULT 0,
  "overridden" BOOLEAN NOT NULL DEFAULT false,
  "override_reason" VARCHAR(500),
  "evaluated_by_id" UUID,
  "evaluated_by_snapshot" VARCHAR(254),
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "candidate_quality_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_quality_score_check" CHECK ("quality_score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "candidate_quality_candidate_key" ON "candidate_quality_evaluations"("candidate_id");
CREATE INDEX "candidate_quality_decision_score_idx" ON "candidate_quality_evaluations"("decision", "quality_score", "candidate_id");
CREATE INDEX "candidate_quality_relevance_sufficiency_idx" ON "candidate_quality_evaluations"("relevance", "sufficiency");
CREATE INDEX "candidate_quality_evaluator_idx" ON "candidate_quality_evaluations"("evaluated_by_id");

ALTER TABLE "candidate_quality_evaluations" ADD CONSTRAINT "candidate_quality_candidate_fkey" FOREIGN KEY ("candidate_id") REFERENCES "news_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_quality_evaluations" ADD CONSTRAINT "candidate_quality_evaluator_fkey" FOREIGN KEY ("evaluated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
