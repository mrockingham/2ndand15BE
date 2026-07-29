-- CreateEnum
CREATE TYPE "League" AS ENUM ('NFL');

-- CreateEnum
CREATE TYPE "Conference" AS ENUM ('AFC', 'NFC');

-- CreateEnum
CREATE TYPE "Division" AS ENUM ('East', 'North', 'South', 'West');

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "league" "League" NOT NULL,
    "city" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "full_name" VARCHAR(128) NOT NULL,
    "abbreviation" VARCHAR(8) NOT NULL,
    "conference" "Conference" NOT NULL,
    "division" "Division" NOT NULL,
    "primary_color" VARCHAR(7) NOT NULL,
    "secondary_color" VARCHAR(7) NOT NULL,
    "logo_url" TEXT,
    "logo_source" VARCHAR(128),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_provider_mappings" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_team_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_catalog_order_idx" ON "teams"("league", "is_active", "conference", "division", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_league_abbreviation_key" ON "teams"("league", "abbreviation");

-- CreateIndex
CREATE INDEX "team_provider_mappings_team_id_idx" ON "team_provider_mappings"("team_id");

-- CreateIndex
CREATE INDEX "team_provider_mappings_team_provider_idx" ON "team_provider_mappings"("team_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "team_provider_mappings_provider_id_key" ON "team_provider_mappings"("provider", "provider_team_id");

-- AddForeignKey
ALTER TABLE "team_provider_mappings" ADD CONSTRAINT "team_provider_mappings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
