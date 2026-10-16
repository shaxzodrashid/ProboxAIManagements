\set ON_ERROR_STOP on
INSERT INTO "Workspace" (id,slug) VALUES ('board-upgrade-workspace','board-upgrade-workspace');
INSERT INTO "User" (id,"workspaceId","phoneNumber","fullName",status,"updatedAt") VALUES ('board-upgrade-user','board-upgrade-workspace','+998908199999','Legacy multiword name preserved','OPEN',CURRENT_TIMESTAMP);
INSERT INTO "Department" (id,"workspaceId",name,slug,"homePath","updatedAt") VALUES ('board-upgrade-department','board-upgrade-workspace','Upgrade','upgrade','/opt/isolated-upgrade',CURRENT_TIMESTAMP);
INSERT INTO "Project" (id,"workspaceId","departmentId","creatorId",name,"directoryName","updatedAt") VALUES ('board-upgrade-project','board-upgrade-workspace','board-upgrade-department','board-upgrade-user','Legacy project','legacy-directory',CURRENT_TIMESTAMP);
INSERT INTO "Task" (id,"workspaceId","creatorId","managerId",title,description,criteria,status,"updatedAt") VALUES ('board-upgrade-task','board-upgrade-workspace','board-upgrade-user','board-upgrade-user','Legacy independent task','Do not infer a project link','Preserve execution status','RUNNING',CURRENT_TIMESTAMP);
INSERT INTO "Permission" (key,name,description,category,"updatedAt") VALUES ('projects.update','Update','test','test',CURRENT_TIMESTAMP) ON CONFLICT (key) DO NOTHING;
INSERT INTO "Role" (id,"workspaceId",key,name,"updatedAt") VALUES ('board-upgrade-role','board-upgrade-workspace','legacy','Legacy',CURRENT_TIMESTAMP);
INSERT INTO "RolePermission" ("roleId","permissionKey") VALUES ('board-upgrade-role','projects.update');
CREATE TABLE isolated_board_upgrade_evidence(kind TEXT PRIMARY KEY,digest TEXT NOT NULL);
INSERT INTO isolated_board_upgrade_evidence VALUES
 ('task',(SELECT md5(row_to_json(t)::text) FROM "Task" t WHERE id='board-upgrade-task')),
 ('project',(SELECT md5(row_to_json(p)::text) FROM "Project" p WHERE id='board-upgrade-project')),
 ('user',(SELECT md5(row_to_json(u)::text) FROM "User" u WHERE id='board-upgrade-user'));
