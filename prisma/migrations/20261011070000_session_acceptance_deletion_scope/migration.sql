ALTER TYPE "TurnStatus" ADD VALUE 'QUEUED';
ALTER TABLE "ProboxAiTurn" ADD COLUMN "requestId" TEXT,
  ADD COLUMN "requestedById" TEXT, ADD COLUMN "executionStartedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ProboxAiTurn_sessionId_requestId_key" ON "ProboxAiTurn"("sessionId", "requestId");
ALTER TABLE "ProjectDeletionAudit" ADD COLUMN "workspaceId" TEXT;
-- Preserve the resource's workspace, never infer it from an owner's current account.
UPDATE "ProjectDeletionAudit" a SET "workspaceId" = d."workspaceId"
FROM "Department" d WHERE d.id = a."departmentId";
CREATE INDEX "ProjectDeletionAudit_workspaceId_projectId_idx" ON "ProjectDeletionAudit"("workspaceId", "projectId");
