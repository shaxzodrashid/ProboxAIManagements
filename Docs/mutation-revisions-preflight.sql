-- READ ONLY preflight for 20261011020000_mutation_revisions.
-- Run against the intended database before deployment under an approved process.
-- Reconcile each group deliberately; do not auto-delete or publish drafts.
SELECT "templateId", count(*) AS "draftCount", array_agg("id" ORDER BY "createdAt", "id") AS "draftIds"
FROM "ConfigurationTemplateVersion"
WHERE "status" = 'DRAFT'
GROUP BY "templateId" HAVING count(*) > 1;

SELECT "id", "workspaceId", "name", "status"
FROM "Department" WHERE "isDefault" AND "status" <> 'ACTIVE';

-- After deliberate reconciliation and deployment, inspect constraint validation.
SELECT conname, convalidated FROM pg_constraint
WHERE conname = 'Department_default_must_be_active';
-- Validation is a separate write requiring deployment authorization:
-- ALTER TABLE "Department" VALIDATE CONSTRAINT "Department_default_must_be_active";
