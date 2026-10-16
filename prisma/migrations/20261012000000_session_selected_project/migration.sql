-- Preserve selection identity even if the project is deleted: launch then fails closed.
-- Legacy/manual sessions remain NULL. No backfill or production application.
ALTER TABLE "ProboxAiSession" ADD COLUMN "selectedProjectId" TEXT;
