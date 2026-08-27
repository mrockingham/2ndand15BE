-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "content_type" "NewsContentType" NOT NULL DEFAULT 'ARTICLE',
ADD COLUMN     "media_thumbnail_url" TEXT;

-- CreateIndex
CREATE INDEX "articles_content_type_published_idx" ON "articles"("content_type", "published_at", "id");
