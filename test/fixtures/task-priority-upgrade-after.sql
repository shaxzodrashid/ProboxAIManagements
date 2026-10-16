\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT value FROM isolated_priority_upgrade_evidence WHERE kind='state') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s)-'priority' ORDER BY "taskId") FROM "TaskHumanState" s) THEN RAISE EXCEPTION 'Human revision/state changed'; END IF;
 IF EXISTS (SELECT 1 FROM "TaskHumanState" WHERE priority IS NOT NULL) THEN RAISE EXCEPTION 'Legacy priority inferred'; END IF;
 IF (SELECT value FROM isolated_priority_upgrade_evidence WHERE kind='tasks') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Task" t) THEN RAISE EXCEPTION 'Task scalars changed'; END IF;
 IF (SELECT value FROM isolated_priority_upgrade_evidence WHERE kind='items') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "TaskChecklistItem" i) THEN RAISE EXCEPTION 'Checklist state changed'; END IF;
 IF (SELECT value FROM isolated_priority_upgrade_evidence WHERE kind='audit') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM "TaskHumanAudit" a) THEN RAISE EXCEPTION 'History changed'; END IF;
 IF (SELECT value FROM isolated_priority_upgrade_evidence WHERE kind='grants') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r) THEN RAISE EXCEPTION 'Grants changed'; END IF;
END $$;
SELECT 'Human priority upgrade preservation passed' AS result;
