\set ON_ERROR_STOP on
INSERT INTO "TaskChecklistItem" (id,"taskId","assigneeId",title,position,completed,"completedById","completedAt","updatedAt") VALUES
 ('deadline-upgrade-open','board-upgrade-task','board-upgrade-user','Legacy open item',0,false,NULL,NULL,now()),
 ('deadline-upgrade-done','board-upgrade-task','board-upgrade-user','Legacy completed item',1,true,'board-upgrade-user',now(),now());
CREATE TABLE isolated_checklist_deadline_evidence(kind TEXT PRIMARY KEY,value JSONB NOT NULL);
INSERT INTO isolated_checklist_deadline_evidence VALUES
 ('items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "TaskChecklistItem" i)),
 ('tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Task" t)),
 ('audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM "TaskHumanAudit" a)),
 ('task_deadlines',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY "taskId"),'[]'::jsonb) FROM "TaskDeadline" d)),
 ('grants',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r));
