BEGIN;
CREATE TABLE "ProjectLifecycleExecution" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectLifecycleExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectLifecycleExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProjectLifecycleExecution_projectId_finishedAt_idx" ON "ProjectLifecycleExecution"("projectId", "finishedAt");
COMMIT;
