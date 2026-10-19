BEGIN;
-- Additive, no historical linking/completion inference and no role/permission writes.
ALTER TABLE "TaskHumanState" ADD COLUMN "completed" BOOLEAN,
  ADD COLUMN "completedById" TEXT, ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "TaskHumanState" ADD CONSTRAINT "TaskHumanState_completion_valid" CHECK (
  ("completed" IS TRUE AND "completedById" IS NOT NULL AND "completedAt" IS NOT NULL)
  OR ("completed" IS NOT TRUE AND "completedById" IS NULL AND "completedAt" IS NULL)
);
CREATE TABLE "TaskSharedBoardEntry" (
  "taskId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "boardId" TEXT NOT NULL, "statusId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("taskId","boardId"),
  FOREIGN KEY ("boardId","statusId") REFERENCES "TaskBoardStatus"("boardId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TaskSharedBoardEntry_boardId_statusId_idx" ON "TaskSharedBoardEntry"("boardId","statusId");
CREATE TABLE "TaskSharingOperation" (
  "taskId" TEXT NOT NULL REFERENCES "TaskHumanState"("taskId") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "targetProjectId" TEXT, "action" TEXT NOT NULL, "revision" INTEGER NOT NULL CHECK ("revision">0),
  "inputHash" TEXT NOT NULL, "outcome" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("taskId","requestId")
);
CREATE UNIQUE INDEX "TaskSharingOperation_taskId_revision_key" ON "TaskSharingOperation"("taskId","revision");
CREATE FUNCTION check_shared_task_board_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Task" t
    JOIN "TaskBoardEntry" original ON original."taskId"=t.id
    JOIN "TaskBoard" source ON source.id=original."boardId"
    JOIN "Project" source_project ON source_project.id=source."projectId"
    JOIN "TaskBoard" destination ON destination.id=NEW."boardId"
    JOIN "Project" destination_project ON destination_project.id=destination."projectId"
    JOIN "TaskHumanState" state ON state."taskId"=t.id
    WHERE t.id=NEW."taskId" AND original."boardId"<>NEW."boardId"
      AND t."workspaceId"=source_project."workspaceId"
      AND t."workspaceId"=destination_project."workspaceId"
  ) THEN RAISE EXCEPTION 'Invalid shared task board scope'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_task_board_scope BEFORE INSERT OR UPDATE OF "taskId","boardId" ON "TaskSharedBoardEntry"
FOR EACH ROW EXECUTE FUNCTION check_shared_task_board_scope();
COMMIT;
