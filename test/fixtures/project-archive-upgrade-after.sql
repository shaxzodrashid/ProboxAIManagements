\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT value FROM isolated_archive_upgrade_evidence WHERE kind='project') IS DISTINCT FROM (SELECT to_jsonb(p)-'archivedAt'-'archiveRevision' FROM "Project" p WHERE id='board-upgrade-project') THEN RAISE EXCEPTION 'Legacy project values changed'; END IF;
 IF EXISTS(SELECT 1 FROM "Project" WHERE "archivedAt" IS NOT NULL OR "archiveRevision"<>0) THEN RAISE EXCEPTION 'Historical archive inferred'; END IF;
 IF (SELECT value FROM isolated_archive_upgrade_evidence WHERE kind='task') IS DISTINCT FROM (SELECT to_jsonb(t) FROM "Task" t WHERE id='board-upgrade-task') THEN RAISE EXCEPTION 'Legacy task changed'; END IF;
 IF (SELECT value FROM isolated_archive_upgrade_evidence WHERE kind='user') IS DISTINCT FROM (SELECT to_jsonb(u) FROM "User" u WHERE id='board-upgrade-user') THEN RAISE EXCEPTION 'Legacy account changed'; END IF;
 IF (SELECT value FROM isolated_archive_upgrade_evidence WHERE kind='grants') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId", "permissionKey"),'[]'::jsonb) FROM "RolePermission" r) THEN RAISE EXCEPTION 'Existing grants changed'; END IF;
 IF EXISTS(SELECT 1 FROM "ProjectArchiveOperation") OR EXISTS(SELECT 1 FROM "ProjectLifecycleExecution") OR EXISTS(SELECT 1 FROM "TaskBoardEntry") THEN RAISE EXCEPTION 'Historical records inferred'; END IF;
END $$;
SELECT 'legacy project values, whole task/account rows and all grants preserved; archive defaults null/0; no inferred history' AS result;
