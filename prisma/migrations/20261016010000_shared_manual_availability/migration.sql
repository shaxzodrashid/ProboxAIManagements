BEGIN;
CREATE TYPE "ManualAvailability" AS ENUM ('AVAILABLE', 'AWAY', 'BUSY');
CREATE TABLE "ManualProfileStatus" (
  "ownerId" TEXT NOT NULL PRIMARY KEY,
  "availability" "ManualAvailability",
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  CONSTRAINT "ManualProfileStatus_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ManualProfileStatusMutation" (
  "ownerId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" >= 0),
  "revision" INTEGER NOT NULL,
  "before" "ManualAvailability",
  "availability" "ManualAvailability",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualProfileStatusMutation_pkey" PRIMARY KEY ("ownerId", "requestId"),
  CONSTRAINT "ManualProfileStatusMutation_revision_check" CHECK ("revision" = "expectedRevision" + 1),
  CONSTRAINT "ManualProfileStatusMutation_actor_check" CHECK ("actorId" = "ownerId"),
  CONSTRAINT "ManualProfileStatusMutation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "ManualProfileStatus"("ownerId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualProfileStatusMutation_ownerId_revision_key" ON "ManualProfileStatusMutation"("ownerId", "revision");
-- No user-row rewrite, selected default, grant or legacy STATUS policy backfill.
COMMIT;
