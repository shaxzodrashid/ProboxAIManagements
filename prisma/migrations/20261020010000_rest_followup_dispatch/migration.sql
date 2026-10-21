BEGIN;

-- Only new REST acceptances opt in. Existing pending/ambiguous work must not
-- acquire a new automatic-execution policy through a migration backfill.
ALTER TABLE "ProboxAiTurn" ADD COLUMN "durableDispatch" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ProboxAiTurn_durableDispatch_status_executionStartedAt_session_idx"
ON "ProboxAiTurn"("durableDispatch", "status", "executionStartedAt", "sessionId");

COMMIT;
