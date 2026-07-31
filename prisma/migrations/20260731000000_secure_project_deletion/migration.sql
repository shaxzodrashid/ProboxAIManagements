ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'DELETING';

CREATE TYPE "ProjectFileTrashStatus" AS ENUM ('ACTIVE', 'RESTORED', 'PURGED', 'PURGE_FAILED');
CREATE TYPE "ProjectFileDeletionConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "ProjectDeletionRequestStatus" AS ENUM ('PENDING_OWNER_APPROVAL', 'AWAITING_ACTIVE_SESSIONS', 'AWAITING_TOKEN', 'DELETING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "ProjectProtectedFileType" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectProtectedFileType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectProtectedFileType_projectId_extension_key" ON "ProjectProtectedFileType"("projectId", "extension");
CREATE INDEX "ProjectProtectedFileType_projectId_createdAt_idx" ON "ProjectProtectedFileType"("projectId", "createdAt");

CREATE TABLE "ProjectFileTrashItem" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "originalPath" TEXT NOT NULL,
  "trashPath" TEXT NOT NULL,
  "isDirectory" BOOLEAN NOT NULL,
  "deletedById" TEXT NOT NULL,
  "status" "ProjectFileTrashStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoredAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectFileTrashItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectFileTrashItem_projectId_trashPath_key" ON "ProjectFileTrashItem"("projectId", "trashPath");
CREATE INDEX "ProjectFileTrashItem_status_expiresAt_idx" ON "ProjectFileTrashItem"("status", "expiresAt");

CREATE TABLE "ProjectFileDeletionConfirmation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "targetPath" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "status" "ProjectFileDeletionConfirmationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectFileDeletionConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectFileDeletionConfirmation_projectId_status_expiresAt_idx" ON "ProjectFileDeletionConfirmation"("projectId", "status", "expiresAt");

CREATE TABLE "ProjectDeletionRequest" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "status" "ProjectDeletionRequestStatus" NOT NULL DEFAULT 'PENDING_OWNER_APPROVAL',
  "tokenHash" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "tokenAttempts" INTEGER NOT NULL DEFAULT 0,
  "activeSessionAction" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "failure" TEXT,
  CONSTRAINT "ProjectDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectDeletionRequest_projectId_status_requestedAt_idx" ON "ProjectDeletionRequest"("projectId", "status", "requestedAt");
CREATE INDEX "ProjectDeletionRequest_ownerId_status_requestedAt_idx" ON "ProjectDeletionRequest"("ownerId", "status", "requestedAt");

CREATE TABLE "ProjectDeletionAudit" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "directoryName" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "quarantinePath" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ProjectDeletionAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectDeletionAudit_projectId_createdAt_idx" ON "ProjectDeletionAudit"("projectId", "createdAt");
CREATE INDEX "ProjectDeletionAudit_status_createdAt_idx" ON "ProjectDeletionAudit"("status", "createdAt");

ALTER TABLE "ProjectProtectedFileType" ADD CONSTRAINT "ProjectProtectedFileType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectProtectedFileType" ADD CONSTRAINT "ProjectProtectedFileType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectFileTrashItem" ADD CONSTRAINT "ProjectFileTrashItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFileTrashItem" ADD CONSTRAINT "ProjectFileTrashItem_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectFileDeletionConfirmation" ADD CONSTRAINT "ProjectFileDeletionConfirmation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectFileDeletionConfirmation" ADD CONSTRAINT "ProjectFileDeletionConfirmation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDeletionRequest" ADD CONSTRAINT "ProjectDeletionRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDeletionRequest" ADD CONSTRAINT "ProjectDeletionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDeletionAudit" ADD CONSTRAINT "ProjectDeletionAudit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
