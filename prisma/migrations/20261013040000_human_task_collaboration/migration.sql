BEGIN;
-- CreateTable
CREATE TABLE "TaskHumanState" (
    "taskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHumanState_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskHumanAudit" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "comment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHumanAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_taskId_idx" ON "TaskAssignee"("userId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskChecklistItem_taskId_position_key" ON "TaskChecklistItem"("taskId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaskComment_taskId_revision_key" ON "TaskComment"("taskId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TaskHumanAudit_taskId_requestId_key" ON "TaskHumanAudit"("taskId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskHumanAudit_taskId_revision_key" ON "TaskHumanAudit"("taskId", "revision");

-- AddForeignKey
ALTER TABLE "TaskHumanState" ADD CONSTRAINT "TaskHumanState_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHumanAudit" ADD CONSTRAINT "TaskHumanAudit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TaskHumanState"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskHumanState" ADD CONSTRAINT "TaskHumanState_revision_check" CHECK (revision >= 0);
ALTER TABLE "TaskHumanAudit" ADD CONSTRAINT "TaskHumanAudit_revision_check" CHECK (revision > 0);
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_fields_check" CHECK (position >= 0 AND length(btrim(title)) BETWEEN 1 AND 200 AND ((completed AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR (NOT completed AND "completedAt" IS NULL AND "completedById" IS NULL)));
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_fields_check" CHECK (revision > 0 AND length(btrim(body)) BETWEEN 1 AND 4000);
INSERT INTO "Permission" (key,name,description,category,"updatedAt") VALUES
 ('tasks.details.manage','Edit owned human task details','Edit owned project task title and description.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.assignees.manage','Manage owned task assignments','Replace assignees of owned project tasks.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.checklists.manage','Manage owned task checklists','Manage owned task checklist definitions.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.checklists.complete','Complete assigned checklist items','Check or uncheck only caller-assigned checklist items.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.comments.create','Comment on assigned tasks','Append plain human comments only on assigned tasks.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.workflow.move','Move assigned human tasks','Change workflow column only for assigned tasks, never execution status.','Tasks',CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
-- No historical assignees/checklists/comments/state and no implicit role grants.
COMMIT;
