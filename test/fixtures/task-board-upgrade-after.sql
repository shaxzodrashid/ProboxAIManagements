\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT digest FROM isolated_board_upgrade_evidence WHERE kind='task') IS DISTINCT FROM (SELECT md5(row_to_json(t)::text) FROM "Task" t WHERE id='board-upgrade-task') THEN RAISE EXCEPTION 'Task changed during migration'; END IF;
 IF (SELECT digest FROM isolated_board_upgrade_evidence WHERE kind='project') IS DISTINCT FROM (SELECT md5(row_to_json(p)::text) FROM "Project" p WHERE id='board-upgrade-project') THEN RAISE EXCEPTION 'Project changed during migration'; END IF;
 IF (SELECT digest FROM isolated_board_upgrade_evidence WHERE kind='user') IS DISTINCT FROM (SELECT md5(row_to_json(u)::text) FROM "User" u WHERE id='board-upgrade-user') THEN RAISE EXCEPTION 'User changed during migration'; END IF;
 IF (SELECT count(*) FROM "TaskBoard" WHERE "projectId"='board-upgrade-project') <> 1 THEN RAISE EXCEPTION 'Expected exactly one legacy project board'; END IF;
 IF (SELECT array_agg(s.name ORDER BY s.position) FROM "TaskBoardStatus" s JOIN "TaskBoard" b ON b.id=s."boardId" WHERE b."projectId"='board-upgrade-project') <> ARRAY['To do','In progress','Review','Done'] THEN RAISE EXCEPTION 'Default columns mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM "TaskBoardEntry") THEN RAISE EXCEPTION 'Historical task association inferred'; END IF;
 IF EXISTS(SELECT 1 FROM "RolePermission" WHERE "permissionKey" IN ('tasks.boards.read','tasks.statuses.manage','tasks.deadlines.manage')) THEN RAISE EXCEPTION 'New privilege implicitly granted'; END IF;
 IF to_regclass('"TaskDeadline"') IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM "TaskDeadline") OR EXISTS(SELECT 1 FROM "TaskDeadlineAudit") THEN RAISE EXCEPTION 'Historical deadline inferred'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "RolePermission" WHERE "roleId"='board-upgrade-role' AND "permissionKey"='projects.update') THEN RAISE EXCEPTION 'Legacy privilege changed'; END IF;
END;
$$;
SELECT 'legacy task/project/account bytes preserved; one board/default4; no task links; no implicit grants' AS result;
