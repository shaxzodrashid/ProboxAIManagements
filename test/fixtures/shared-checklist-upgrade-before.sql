-- Synthetic temporary tables shadow the real fixture tables for this connection.
-- The composed verification wraps these plus the actual migration in ROLLBACK.
CREATE TEMP TABLE "TaskHumanState" ("taskId" TEXT PRIMARY KEY, revision INT, completed BOOLEAN);
CREATE TEMP TABLE "TaskChecklistItem" (
  id TEXT PRIMARY KEY, "taskId" TEXT, title TEXT, position INT, "assigneeId" TEXT,
  completed BOOLEAN, "completedById" TEXT, "completedAt" TIMESTAMP(3), deadline JSONB,
  UNIQUE ("taskId", position)
);
CREATE TEMP TABLE "TaskHumanAudit" (id TEXT PRIMARY KEY, before JSONB, after JSONB);
INSERT INTO "TaskHumanState" VALUES ('synthetic-task',7,true);
INSERT INTO "TaskChecklistItem" VALUES
 ('synthetic-open','synthetic-task','Before upgrade',0,'synthetic-person',false,NULL,NULL,NULL),
 ('synthetic-done','synthetic-task','Retained deadline',1,'synthetic-person',true,'synthetic-person','2026-10-20 00:00:00','{"kind":"DATE","date":"2026-12-01","time":null,"timeZone":null,"utcOffset":null,"instant":null}');
INSERT INTO "TaskHumanAudit" VALUES ('synthetic-audit','{"checklist":[{"id":"retired","title":"Old snapshot"}]}','{"revision":7,"legacy":"unchanged"}');
CREATE TEMP TABLE old_state AS SELECT to_jsonb(s) AS value FROM "TaskHumanState" s;
CREATE TEMP TABLE old_items AS SELECT id, to_jsonb(i) AS value FROM "TaskChecklistItem" i;
CREATE TEMP TABLE old_audit AS SELECT to_jsonb(a) AS value FROM "TaskHumanAudit" a;
