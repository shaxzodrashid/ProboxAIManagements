\set ON_ERROR_STOP on
CREATE TABLE isolated_shared_status_upgrade_evidence (
  id BOOLEAN PRIMARY KEY CHECK (id), user_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL, grant_digest TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO isolated_shared_status_upgrade_evidence
SELECT TRUE,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id)::text FROM "User" u), 'null')),
  md5(coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."ownerId", p.field)::text FROM "ProfileAudiencePolicy" p), 'null')),
  md5(coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g."roleId", g."permissionKey")::text FROM "RolePermission" g), 'null'));
