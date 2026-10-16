ALTER TABLE "ProboxAiSession" ADD COLUMN "runOwner" TEXT, ADD COLUMN "runLeaseExpiresAt" TIMESTAMP(3), ADD COLUMN "recoveryReason" TEXT, ADD COLUMN "stopConfirmation" TEXT NOT NULL DEFAULT 'NOT_OBSERVED', ADD COLUMN "interruptRequestedAt" TIMESTAMP(3), ADD COLUMN "interruptSignalAcceptedAt" TIMESTAMP(3), ADD COLUMN "runnerExitedAt" TIMESTAMP(3);
ALTER TABLE "SessionEvent" ADD COLUMN "projectionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProboxAiTurn" ADD COLUMN "executionPermission" TEXT;
CREATE INDEX "ProboxAiSession_runLeaseExpiresAt_idx" ON "ProboxAiSession"("runLeaseExpiresAt");
