ALTER TYPE "ProjectFileTrashStatus" ADD VALUE 'PREPARED';
ALTER TYPE "ProjectFileTrashStatus" ADD VALUE 'NEEDS_REPAIR';
ALTER TYPE "ProjectFileTrashStatus" ADD VALUE 'FAILED';
CREATE TABLE "ProjectFileOperation" (
 "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
 "originalPath" TEXT NOT NULL, "state" TEXT NOT NULL,
 "sourceIdentity" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "isDirectory" BOOLEAN NOT NULL,
 "confirmationId" TEXT, "trashId" TEXT, "result" JSONB, "errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProjectFileOperation_pkey" PRIMARY KEY ("projectId", "id"),
 CONSTRAINT "ProjectFileOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ProjectFileOperation_state_check" CHECK ("state" IN ('AWAITING_CONFIRMATION','PREPARED','COMPLETED','FAILED','NEEDS_REPAIR'))
);
CREATE UNIQUE INDEX "ProjectFileOperation_confirmationId_key" ON "ProjectFileOperation"("confirmationId");
CREATE UNIQUE INDEX "ProjectFileOperation_trashId_key" ON "ProjectFileOperation"("trashId");
CREATE INDEX "ProjectFileOperation_projectId_createdAt_idx" ON "ProjectFileOperation"("projectId", "createdAt");
