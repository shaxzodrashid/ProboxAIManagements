BEGIN;
CREATE TABLE "TaskCreationReceipt" (
  "workspaceId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  "outcome" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskCreationReceipt_pkey" PRIMARY KEY ("workspaceId", "creatorId", "requestId"),
  CONSTRAINT "TaskCreationReceipt_outcome_check" CHECK (jsonb_typeof("outcome") = 'object'),
  CONSTRAINT "TaskCreationReceipt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskCreationReceipt_creatorId_workspaceId_fkey" FOREIGN KEY ("creatorId", "workspaceId") REFERENCES "User"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskCreationReceipt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskCreationReceipt_taskId_key" ON "TaskCreationReceipt"("taskId");
-- Opt-in receipts only. No historical task rewrite, grant or publication backfill.
COMMIT;
