\set ON_ERROR_STOP on
DO $$
DECLARE e isolated_task_creation_upgrade_evidence%ROWTYPE;
BEGIN
  SELECT * INTO STRICT e FROM isolated_task_creation_upgrade_evidence;
  IF e.task_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM "Task" t), 'null'))
    OR e.user_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id)::text FROM "User" u), 'null'))
    OR e.grant_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."roleId", p."permissionKey")::text FROM "RolePermission" p), 'null'))
  THEN RAISE EXCEPTION 'Task creation migration changed legacy records or grants'; END IF;
  IF EXISTS (SELECT 1 FROM "TaskCreationReceipt")
  THEN RAISE EXCEPTION 'Task creation migration inferred historical receipts'; END IF;
END $$;
SELECT 'Legacy task/user/grant digests unchanged; zero inferred receipts' AS verified;
