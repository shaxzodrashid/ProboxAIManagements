-- AlterTable
BEGIN;

ALTER TABLE "ProboxAiSession" ADD COLUMN     "creationAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "creationInitialTurnId" TEXT,
ADD COLUMN     "creationInputHash" VARCHAR(64),
ADD COLUMN     "creationRequestId" TEXT,
ADD COLUMN     "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastDispatchAt" TIMESTAMP(3),
ADD COLUMN     "runtimeProvenance" JSONB;

-- AlterTable
ALTER TABLE "ProboxAiTurn" ADD COLUMN     "encryptedPrompt" TEXT,
ADD COLUMN     "inputHash" VARCHAR(64),
ADD COLUMN     "usageProvenance" JSONB;

-- AlterTable
ALTER TABLE "SessionEvent" ADD COLUMN     "archiveHash" VARCHAR(64),
ADD COLUMN     "archivePayload" JSONB,
ADD COLUMN     "archivePolicyVersion" INTEGER;

-- CreateIndex
CREATE INDEX "ProboxAiSession_status_runLeaseExpiresAt_createdAt_idx" ON "ProboxAiSession"("status", "runLeaseExpiresAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProboxAiSession_creatorId_creationRequestId_key" ON "ProboxAiSession"("creatorId", "creationRequestId");

-- CreateIndex
CREATE INDEX "ProboxAiTurn_sessionId_startedAt_id_idx" ON "ProboxAiTurn"("sessionId", "startedAt", "id");

ALTER TABLE "ProboxAiSession" ADD CONSTRAINT "ProboxAiSession_creation_identity_complete" CHECK (
  ("creationRequestId" IS NULL AND "creationInputHash" IS NULL AND "creationInitialTurnId" IS NULL AND "creationAcceptedAt" IS NULL)
  OR ("creationRequestId" IS NOT NULL AND "creationInputHash" IS NOT NULL AND "creationInitialTurnId" IS NOT NULL AND "creationAcceptedAt" IS NOT NULL)
);
ALTER TABLE "ProboxAiSession" ADD CONSTRAINT "ProboxAiSession_dispatch_attempts_nonnegative" CHECK ("dispatchAttempts" >= 0);
COMMIT;
