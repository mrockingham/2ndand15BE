-- AlterTable
ALTER TABLE "users" ADD COLUMN "favorite_team_id" UUID;

-- CreateIndex
CREATE INDEX "users_favorite_team_id_idx" ON "users"("favorite_team_id");

-- AddForeignKey
ALTER TABLE "users"
ADD CONSTRAINT "users_favorite_team_id_fkey"
FOREIGN KEY ("favorite_team_id") REFERENCES "teams"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
