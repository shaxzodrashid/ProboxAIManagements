BEGIN;
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "archiveRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD CONSTRAINT "Project_archiveRevision_check" CHECK ("archiveRevision" >= 0);
CREATE TABLE "ProjectArchiveOperation" (
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "archivedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectArchiveOperation_pkey" PRIMARY KEY ("projectId", "requestId"),
  CONSTRAINT "ProjectArchiveOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectArchiveOperation_projectId_revision_key" ON "ProjectArchiveOperation"("projectId", "revision");
INSERT INTO "Permission" ("key", "name", "description", "category", "updatedAt") VALUES ('projects.archive', 'Archive projects', 'Archive owned projects without deleting records or files.', 'Projects', CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
COMMIT;
