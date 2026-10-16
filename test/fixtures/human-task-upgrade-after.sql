\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT value FROM isolated_human_upgrade_evidence WHERE kind='task') IS DISTINCT FROM (SELECT to_jsonb(t) FROM "Task" t WHERE id='board-upgrade-task') THEN RAISE EXCEPTION 'Legacy Task row changed'; END IF;
 IF (SELECT value FROM isolated_human_upgrade_evidence WHERE kind='user') IS DISTINCT FROM (SELECT to_jsonb(u) FROM "User" u WHERE id='board-upgrade-user') THEN RAISE EXCEPTION 'Legacy User row changed'; END IF;
 IF (SELECT value FROM isolated_human_upgrade_evidence WHERE kind='project') IS DISTINCT FROM (SELECT to_jsonb(p) FROM "Project" p WHERE id='board-upgrade-project') THEN RAISE EXCEPTION 'Legacy Project row changed'; END IF;
 IF (SELECT value FROM isolated_human_upgrade_evidence WHERE kind='grants') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r) THEN RAISE EXCEPTION 'Role grants changed'; END IF;
 IF (SELECT value FROM isolated_human_upgrade_evidence WHERE kind='columns') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM "TaskBoardStatus" s) THEN RAISE EXCEPTION 'Workflow columns changed'; END IF;
 IF EXISTS(SELECT 1 FROM "TaskHumanState") OR EXISTS(SELECT 1 FROM "TaskAssignee") OR EXISTS(SELECT 1 FROM "TaskChecklistItem") OR EXISTS(SELECT 1 FROM "TaskComment") OR EXISTS(SELECT 1 FROM "TaskHumanAudit") OR EXISTS(SELECT 1 FROM "TaskBoardEntry") THEN RAISE EXCEPTION 'Human history or links inferred'; END IF;
END $$;
SELECT 'whole legacy task/user/project rows, workflow columns and all grants preserved; no human links/assignments/history inferred' AS result;
