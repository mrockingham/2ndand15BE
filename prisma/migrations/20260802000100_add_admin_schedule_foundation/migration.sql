-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "GameSourceType" AS ENUM ('MANUAL_IMPORT', 'MANUAL_ENTRY', 'OFFICIAL_WEB', 'PROVIDER', 'EDITORIAL_OVERRIDE', 'DEVELOPMENT_FIXTURE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "game_provenances" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "source_type" "GameSourceType" NOT NULL,
    "source_name" VARCHAR(160) NOT NULL,
    "source_url" TEXT,
    "external_reference" VARCHAR(256),
    "notes" VARCHAR(1000),
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "game_provenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_editorial_overrides" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(3),
    "status" "GameStatus",
    "week" INTEGER,
    "venue_name" VARCHAR(160),
    "venue_city" VARCHAR(128),
    "broadcast_network" VARCHAR(64),
    "is_neutral_site" BOOLEAN,
    "public_correction_note" VARCHAR(500),
    "internal_note" VARCHAR(1000),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_by_snapshot" VARCHAR(254) NOT NULL,
    "updated_by_snapshot" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "game_editorial_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "game_editorial_overrides_week_check" CHECK ("week" IS NULL OR "week" BETWEEN 1 AND 22)
);

-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_email_snapshot" VARCHAR(254) NOT NULL,
    "action" VARCHAR(96) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(128),
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "request_id" VARCHAR(128),
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "game_provenances_game_id_key" ON "game_provenances"("game_id");
CREATE UNIQUE INDEX "game_provenances_source_reference_key" ON "game_provenances"("source_name", "external_reference");
CREATE INDEX "game_provenances_source_imported_idx" ON "game_provenances"("source_type", "imported_at");
CREATE INDEX "game_provenances_verified_by_idx" ON "game_provenances"("verified_by_id");
CREATE UNIQUE INDEX "game_editorial_overrides_game_id_key" ON "game_editorial_overrides"("game_id");
CREATE INDEX "game_editorial_overrides_created_by_idx" ON "game_editorial_overrides"("created_by_id");
CREATE INDEX "game_editorial_overrides_updated_by_idx" ON "game_editorial_overrides"("updated_by_id");
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events"("created_at", "id");
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events"("entity_type", "entity_id", "created_at");
CREATE INDEX "admin_audit_events_actor_idx" ON "admin_audit_events"("actor_user_id", "created_at");

-- Foreign keys
ALTER TABLE "game_provenances" ADD CONSTRAINT "game_provenances_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_provenances" ADD CONSTRAINT "game_provenances_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "game_editorial_overrides" ADD CONSTRAINT "game_editorial_overrides_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_editorial_overrides" ADD CONSTRAINT "game_editorial_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "game_editorial_overrides" ADD CONSTRAINT "game_editorial_overrides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill current games with durable source classification. Provider mappings remain authoritative.
INSERT INTO "game_provenances" (
    "id", "game_id", "source_type", "source_name", "external_reference", "imported_at", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    g."id",
    CASE WHEN BOOL_OR(gpm."provider" = 'api-sports') THEN 'PROVIDER'::"GameSourceType" ELSE 'DEVELOPMENT_FIXTURE'::"GameSourceType" END,
    CASE WHEN BOOL_OR(gpm."provider" = 'api-sports') THEN 'api-sports' ELSE 'mock' END,
    NULL,
    g."created_at",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "games" g
JOIN "game_provider_mappings" gpm ON gpm."game_id" = g."id"
GROUP BY g."id", g."created_at";
