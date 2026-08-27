-- CreateEnum
CREATE TYPE "NewsContentType" AS ENUM ('ARTICLE', 'VIDEO', 'HIGHLIGHT');

-- AlterTable
ALTER TABLE "news_candidates" ADD COLUMN     "content_type" "NewsContentType" NOT NULL DEFAULT 'ARTICLE',
ADD COLUMN     "media_thumbnail_url" TEXT;

-- AlterTable
ALTER TABLE "news_sources" ADD COLUMN     "content_type" "NewsContentType" NOT NULL DEFAULT 'ARTICLE';
