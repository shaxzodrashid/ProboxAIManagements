-- Persist the validated provider/model/thinking selection used to start each
-- session. Existing rows retain their legacy model as the effective model.
ALTER TABLE "ProboxAiSession"
    ADD COLUMN "providerId" TEXT NOT NULL DEFAULT 'openai',
    ADD COLUMN "requestedModel" TEXT,
    ADD COLUMN "effectiveModel" TEXT,
    ADD COLUMN "requestedReasoningEffort" TEXT,
    ADD COLUMN "effectiveReasoningEffort" TEXT,
    ADD COLUMN "catalogSnapshot" JSONB;

UPDATE "ProboxAiSession"
SET "effectiveModel" = "model"
WHERE "model" IS NOT NULL;
