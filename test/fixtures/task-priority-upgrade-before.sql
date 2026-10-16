\set ON_ERROR_STOP on
INSERT INTO "TaskHumanState" ("taskId",revision) VALUES ('board-upgrade-task',7);
CREATE TABLE isolated_priority_upgrade_evidence(kind TEXT PRIMARY KEY,value JSONB NOT NULL);
INSERT INTO isolated_priority_upgrade_evidence VALUES
 ('state',(SELECT jsonb_agg(to_jsonb(s) ORDER BY "taskId") FROM "TaskHumanState" s)),
 ('tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Task" t)),
 ('items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "TaskChecklistItem" i)),
 ('audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM "TaskHumanAudit" a)),
 ('grants',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r));
