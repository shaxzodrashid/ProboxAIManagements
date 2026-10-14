-- No historical request identity or filesystem proof is inferred.
CREATE TABLE "ProjectCreationSubmission" (
  "workspaceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "templateVersionId" TEXT,
  "targetPath" TEXT NOT NULL,
  "executorId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  "projectId" TEXT,
  "initializationId" TEXT,
  "failureCode" TEXT,
  "executionFinishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectCreationSubmission_pkey" PRIMARY KEY ("workspaceId", "requestId"),
  CONSTRAINT "ProjectCreationSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectCreationSubmission_state_check" CHECK ("state" IN ('UNRESOLVED','COMPLETED')),
  CONSTRAINT "ProjectCreationSubmission_outcome_check" CHECK (("state" = 'COMPLETED') = ("projectId" IS NOT NULL))
);
CREATE INDEX "ProjectCreationSubmission_state_executionFinishedAt_idx" ON "ProjectCreationSubmission"("state", "executionFinishedAt");
