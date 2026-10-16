BEGIN;
ALTER TABLE "TaskChecklistItem" ADD COLUMN "deadline" JSONB;
COMMIT;
