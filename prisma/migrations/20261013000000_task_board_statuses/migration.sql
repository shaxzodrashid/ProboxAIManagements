BEGIN;
-- CreateTable
CREATE TABLE "TaskBoard" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskBoardStatus" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TaskBoardStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskBoardEntry" (
    "taskId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,

    CONSTRAINT "TaskBoardEntry_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskBoardAudit" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "affectedTasks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskBoardAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoard_projectId_key" ON "TaskBoard"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoardStatus_boardId_id_key" ON "TaskBoardStatus"("boardId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoardStatus_boardId_position_key" ON "TaskBoardStatus"("boardId", "position");

-- CreateIndex
CREATE INDEX "TaskBoardEntry_boardId_statusId_idx" ON "TaskBoardEntry"("boardId", "statusId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoardAudit_boardId_revision_key" ON "TaskBoardAudit"("boardId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBoardAudit_boardId_requestId_key" ON "TaskBoardAudit"("boardId", "requestId");

-- AddForeignKey
ALTER TABLE "TaskBoard" ADD CONSTRAINT "TaskBoard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBoardStatus" ADD CONSTRAINT "TaskBoardStatus_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "TaskBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBoardEntry" ADD CONSTRAINT "TaskBoardEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBoardEntry" ADD CONSTRAINT "TaskBoardEntry_boardId_statusId_fkey" FOREIGN KEY ("boardId", "statusId") REFERENCES "TaskBoardStatus"("boardId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBoardAudit" ADD CONSTRAINT "TaskBoardAudit_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "TaskBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskBoard" ADD CONSTRAINT "TaskBoard_revision_nonnegative" CHECK ("revision" >= 0);
ALTER TABLE "TaskBoardStatus" ADD CONSTRAINT "TaskBoardStatus_valid" CHECK ("position" >= 0 AND length(btrim("name")) BETWEEN 1 AND 120 AND "color" IN ('NEUTRAL','TEAL','PURPLE','GREEN'));
ALTER TABLE "TaskBoardAudit" ADD CONSTRAINT "TaskBoardAudit_valid" CHECK ("revision" > 0 AND "affectedTasks" >= 0);

-- Every existing project gets one empty human board. Historical tasks are never
-- inferred from cwd, Telegram binding, creator, name or selected session project.
INSERT INTO "TaskBoard" ("projectId") SELECT "id" FROM "Project";
INSERT INTO "TaskBoardStatus" ("boardId", "name", "color", "position")
SELECT b."id", s.name, s.color, s.position FROM "TaskBoard" b
CROSS JOIN (VALUES ('To do','NEUTRAL',0), ('In progress','TEAL',1), ('Review','PURPLE',2), ('Done','GREEN',3)) AS s(name,color,position);

-- Database trigger keeps exactly-one-board initialization atomic even for older
-- project writers and isolated fixtures. It changes no existing response shape.
CREATE FUNCTION proboxai_initialize_task_board() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_board_id TEXT;
BEGIN
  INSERT INTO "TaskBoard" ("projectId") VALUES (NEW."id") RETURNING "id" INTO new_board_id;
  INSERT INTO "TaskBoardStatus" ("boardId", "name", "color", "position") VALUES
    (new_board_id,'To do','NEUTRAL',0), (new_board_id,'In progress','TEAL',1),
    (new_board_id,'Review','PURPLE',2), (new_board_id,'Done','GREEN',3);
  RETURN NEW;
END;
$$;
CREATE TRIGGER proboxai_project_task_board AFTER INSERT ON "Project"
FOR EACH ROW EXECUTE FUNCTION proboxai_initialize_task_board();

-- Definitions only. Do not insert RolePermission or infer grants from role labels.
INSERT INTO "Permission" ("key","name","description","category","updatedAt") VALUES
 ('tasks.boards.read','View task boards','Read workflow metadata for currently readable projects; does not grant task or session reads.','Tasks',CURRENT_TIMESTAMP),
 ('tasks.statuses.manage','Manage task workflow statuses','Read edit snapshots and manage project workflow columns under project membership or manage-all scope; does not grant task edits or project editing.','Tasks',CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
COMMIT;
