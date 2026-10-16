-- AlterTable
ALTER TABLE "ConfigurationTemplateVersion" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- Existing duplicate drafts must be reconciled explicitly before applying this index.
-- Never delete or publish a draft automatically during migration.
CREATE UNIQUE INDEX "ConfigurationTemplateVersion_one_draft_per_template"
ON "ConfigurationTemplateVersion" ("templateId") WHERE "status" = 'DRAFT';
-- NOT VALID preserves historical rows for deliberate reconciliation; new writes
-- are checked immediately. No new requirement to have any default is introduced.
ALTER TABLE "Department" ADD CONSTRAINT "Department_default_must_be_active"
CHECK (NOT "isDefault" OR "status" = 'ACTIVE') NOT VALID;
