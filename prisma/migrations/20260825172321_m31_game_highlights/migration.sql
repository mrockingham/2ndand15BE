-- CreateEnum
CREATE TYPE "GameHighlightType" AS ENUM ('GAME', 'PLAY', 'PLAYER', 'OTHER');

-- CreateEnum
CREATE TYPE "GameHighlightCoverage" AS ENUM ('PENDING', 'AVAILABLE', 'UNAVAILABLE', 'PROVIDER_ERROR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "game_highlights" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_highlight_key" VARCHAR(128) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "highlight_type" "GameHighlightType" NOT NULL DEFAULT 'GAME',
    "thumbnail_url" TEXT,
    "canonical_url" TEXT,
    "embed_url" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_highlight_sync_state" (
    "game_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "coverage" "GameHighlightCoverage" NOT NULL DEFAULT 'UNKNOWN',
    "last_checked_at" TIMESTAMPTZ(3),
    "provider_count" INTEGER,
    "request_count" INTEGER,
    "error_code" VARCHAR(64),

    CONSTRAINT "game_highlight_sync_state_pkey" PRIMARY KEY ("game_id")
);

-- CreateIndex
CREATE INDEX "game_highlights_game_id_idx" ON "game_highlights"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_highlights_provider_key_key" ON "game_highlights"("provider", "provider_highlight_key");

-- AddForeignKey
ALTER TABLE "game_highlights" ADD CONSTRAINT "game_highlights_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_highlight_sync_state" ADD CONSTRAINT "game_highlight_sync_state_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
