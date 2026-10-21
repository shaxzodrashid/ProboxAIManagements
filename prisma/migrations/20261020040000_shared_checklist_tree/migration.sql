BEGIN;
-- Additive only: legacy flat items remain roots of the original side. No rewrite
-- of identities, positions, assignments, deadlines, comments or audit snapshots.
ALTER TABLE "TaskHumanState" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "TaskChecklistItem" ADD COLUMN "sectionBoardId" TEXT, ADD COLUMN "parentId" TEXT;
-- A retained parent cannot silently disappear, including through an older writer.
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "TaskChecklistItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
COMMIT;
