BEGIN;
-- CreateTable
CREATE TABLE "TaskDeadline" (
    "taskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "value" JSONB,

    CONSTRAINT "TaskDeadline_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskDeadlineAudit" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDeadlineAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskDeadlineAudit_taskId_requestId_key" ON "TaskDeadlineAudit"("taskId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDeadlineAudit_taskId_revision_key" ON "TaskDeadlineAudit"("taskId", "revision");

-- AddForeignKey
ALTER TABLE "TaskDeadline" ADD CONSTRAINT "TaskDeadline_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeadlineAudit" ADD CONSTRAINT "TaskDeadlineAudit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TaskDeadline"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskDeadline" ADD CONSTRAINT "TaskDeadline_valid" CHECK ("revision" >= 0 AND ("value" IS NULL OR (jsonb_typeof("value")='object' AND "value"->>'kind' IN ('DATE','TIMED'))));
ALTER TABLE "TaskDeadlineAudit" ADD CONSTRAINT "TaskDeadlineAudit_revision_positive" CHECK ("revision" > 0);
-- No historical deadline values or implicit role grants.
INSERT INTO "Permission" ("key","name","description","category","updatedAt") VALUES
 ('tasks.deadlines.manage','Manage task deadlines','Read edit snapshots and change deadlines only for tasks currently managed by the caller; read-all does not grant deadline edits.','Tasks',CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
COMMIT;
