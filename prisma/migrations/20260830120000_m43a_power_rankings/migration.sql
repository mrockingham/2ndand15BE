-- CreateEnum
CREATE TYPE "PowerRankingEditionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "power_ranking_editions" (
    "id" UUID NOT NULL,
    "season" INTEGER NOT NULL,
    "edition" VARCHAR(64) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "subtitle" VARCHAR(180),
    "as_of" TIMESTAMPTZ(3) NOT NULL,
    "methodology" TEXT NOT NULL,
    "sources" TEXT[],
    "status" "PowerRankingEditionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "power_ranking_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "power_ranking_entries" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "previous_rank" INTEGER,
    "movement" INTEGER,
    "tier" VARCHAR(64) NOT NULL,
    "headline" VARCHAR(200) NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" TEXT[],
    "concerns" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "power_ranking_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "power_ranking_editions_season_edition_key" ON "power_ranking_editions"("season", "edition");

-- CreateIndex
CREATE INDEX "power_ranking_editions_status_published_idx" ON "power_ranking_editions"("status", "published_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "power_ranking_entries_edition_team_key" ON "power_ranking_entries"("edition_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "power_ranking_entries_edition_rank_key" ON "power_ranking_entries"("edition_id", "rank");

-- CreateIndex
CREATE INDEX "power_ranking_entries_team_idx" ON "power_ranking_entries"("team_id");

-- AddForeignKey
ALTER TABLE "power_ranking_editions" ADD CONSTRAINT "power_ranking_editions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "power_ranking_editions" ADD CONSTRAINT "power_ranking_editions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "power_ranking_entries" ADD CONSTRAINT "power_ranking_entries_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "power_ranking_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "power_ranking_entries" ADD CONSTRAINT "power_ranking_entries_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: rank and previous_rank must fall within the 32-team NFL range.
ALTER TABLE "power_ranking_entries" ADD CONSTRAINT "power_ranking_entries_rank_range_check" CHECK ("rank" >= 1 AND "rank" <= 32);
ALTER TABLE "power_ranking_entries" ADD CONSTRAINT "power_ranking_entries_previous_rank_range_check" CHECK ("previous_rank" IS NULL OR ("previous_rank" >= 1 AND "previous_rank" <= 32));
