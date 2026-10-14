\set ON_ERROR_STOP on
CREATE TABLE isolated_human_upgrade_evidence(kind TEXT PRIMARY KEY,value JSONB NOT NULL);
INSERT INTO isolated_human_upgrade_evidence VALUES
 ('task',(SELECT to_jsonb(t) FROM "Task" t WHERE id='board-upgrade-task')),
 ('user',(SELECT to_jsonb(u) FROM "User" u WHERE id='board-upgrade-user')),
 ('project',(SELECT to_jsonb(p) FROM "Project" p WHERE id='board-upgrade-project')),
 ('grants',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r)),
 ('columns',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM "TaskBoardStatus" s));
