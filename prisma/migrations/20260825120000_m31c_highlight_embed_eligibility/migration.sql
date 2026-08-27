-- CreateEnum
CREATE TYPE "GameHighlightEmbedStatus" AS ENUM ('ALLOWED', 'NOT_ALLOWED', 'GEO_RESTRICTED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "game_highlights" ADD COLUMN     "embed_status" "GameHighlightEmbedStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "can_embed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "embed_checked_at" TIMESTAMPTZ(3);
