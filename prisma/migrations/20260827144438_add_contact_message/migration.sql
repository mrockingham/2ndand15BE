-- CreateEnum
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'READ', 'RESOLVED', 'SPAM');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(150),
    "message" VARCHAR(5000) NOT NULL,
    "status" "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_messages_status_created_idx" ON "contact_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "contact_messages_created_idx" ON "contact_messages"("created_at");

