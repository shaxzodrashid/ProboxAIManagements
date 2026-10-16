\set ON_ERROR_STOP on
CREATE TABLE isolated_archive_upgrade_evidence(kind TEXT PRIMARY KEY, value JSONB NOT NULL);
INSERT INTO isolated_archive_upgrade_evidence VALUES
 ('project', (SELECT to_jsonb(p) FROM "Project" p WHERE id='board-upgrade-project')),
 ('task', (SELECT to_jsonb(t) FROM "Task" t WHERE id='board-upgrade-task')),
 ('user', (SELECT to_jsonb(u) FROM "User" u WHERE id='board-upgrade-user')),
 ('grants', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId", "permissionKey"),'[]'::jsonb) FROM "RolePermission" r));
