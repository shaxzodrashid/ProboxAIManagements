BEGIN;
ALTER TABLE "ProjectFileTrashItem" ADD COLUMN "recoveryToken" TEXT;
CREATE TABLE "ProjectFileTrashRecovery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "trashId" TEXT NOT NULL REFERENCES "ProjectFileTrashItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "action" TEXT NOT NULL CHECK ("action" IN ('RESTORE', 'PURGE')),
  "state" TEXT NOT NULL DEFAULT 'STARTED' CHECK ("state" IN ('STARTED', 'UNKNOWN', 'REJECTED', 'RESTORED', 'PURGED')),
  "errorCode" TEXT,
  "sourceIdentity" TEXT,
  "contentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ProjectFileTrashRecovery_trashId_createdAt_idx" ON "ProjectFileTrashRecovery"("trashId", "createdAt");
COMMIT;
