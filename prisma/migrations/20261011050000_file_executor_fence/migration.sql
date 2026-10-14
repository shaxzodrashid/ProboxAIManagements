ALTER TABLE "ProjectFileOperation" ADD COLUMN "executionTracked" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "executionStartedAt" TIMESTAMP(3), ADD COLUMN "executionFinishedAt" TIMESTAMP(3);
