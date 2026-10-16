\set ON_ERROR_STOP on
DO $$
DECLARE e isolated_shared_status_upgrade_evidence%ROWTYPE;
BEGIN
  SELECT * INTO STRICT e FROM isolated_shared_status_upgrade_evidence;
  IF e.user_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id)::text FROM "User" u), 'null'))
    OR e.policy_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."ownerId", p.field)::text FROM "ProfileAudiencePolicy" p), 'null'))
    OR e.grant_digest IS DISTINCT FROM md5(coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g."roleId", g."permissionKey")::text FROM "RolePermission" g), 'null'))
  THEN RAISE EXCEPTION 'Shared status migration changed legacy users, policies or grants'; END IF;
  IF EXISTS (SELECT 1 FROM "ManualProfileStatus") OR EXISTS (SELECT 1 FROM "ManualProfileStatusMutation")
  THEN RAISE EXCEPTION 'Shared status migration inferred a default or history'; END IF;
END $$;
SELECT 'Legacy users/policies/grants unchanged; zero inferred status values/history' AS verified;
