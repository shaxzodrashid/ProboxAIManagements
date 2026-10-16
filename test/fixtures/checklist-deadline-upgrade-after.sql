\set ON_ERROR_STOP on
DO $$ BEGIN
 IF (SELECT value FROM isolated_checklist_deadline_evidence WHERE kind='items') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(i)-'deadline' ORDER BY id) FROM "TaskChecklistItem" i) THEN RAISE EXCEPTION 'Checklist legacy rows changed'; END IF;
 IF EXISTS (SELECT 1 FROM "TaskChecklistItem" WHERE deadline IS NOT NULL) THEN RAISE EXCEPTION 'Historical deadlines inferred'; END IF;
 IF (SELECT value FROM isolated_checklist_deadline_evidence WHERE kind='tasks') IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Task" t) THEN RAISE EXCEPTION 'Task rows changed'; END IF;
 IF (SELECT value FROM isolated_checklist_deadline_evidence WHERE kind='audit') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM "TaskHumanAudit" a) THEN RAISE EXCEPTION 'Historical audits changed'; END IF;
 IF (SELECT value FROM isolated_checklist_deadline_evidence WHERE kind='task_deadlines') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY "taskId"),'[]'::jsonb) FROM "TaskDeadline" d) THEN RAISE EXCEPTION 'Task deadlines changed'; END IF;
 IF (SELECT value FROM isolated_checklist_deadline_evidence WHERE kind='grants') IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY "roleId","permissionKey"),'[]'::jsonb) FROM "RolePermission" r) THEN RAISE EXCEPTION 'Grants changed'; END IF;
END $$;
SELECT 'Checklist deadline upgrade preservation passed' AS result;
