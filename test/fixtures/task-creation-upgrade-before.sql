\set ON_ERROR_STOP on
CREATE TABLE isolated_task_creation_upgrade_evidence (
  id BOOLEAN PRIMARY KEY CHECK (id),
  task_digest TEXT NOT NULL,
  user_digest TEXT NOT NULL,
  grant_digest TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO isolated_task_creation_upgrade_evidence
SELECT TRUE,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM "Task" t), 'null')),
  md5(coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id)::text FROM "User" u), 'null')),
  md5(coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."roleId", p."permissionKey")::text FROM "RolePermission" p), 'null'));
