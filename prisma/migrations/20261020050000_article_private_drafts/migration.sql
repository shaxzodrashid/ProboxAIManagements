BEGIN;
-- Additive only. No prior data rewrite, permission grant or published content.
CREATE TABLE "ArticleDraftSpace" (
  "projectId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "projectRefId" TEXT,
  "ownerRefId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "forest" JSONB NOT NULL,
  CONSTRAINT "ArticleDraftSpace_pkey" PRIMARY KEY ("projectId", "ownerId"),
  CONSTRAINT "ArticleDraftSpace_projectRefId_fkey" FOREIGN KEY ("projectRefId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ArticleDraftSpace_ownerRefId_fkey" FOREIGN KEY ("ownerRefId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "ArticleDraftRevision" (
  "projectId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "forest" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArticleDraftRevision_pkey" PRIMARY KEY ("projectId", "ownerId", "revision"),
  CONSTRAINT "ArticleDraftRevision_projectId_ownerId_fkey" FOREIGN KEY ("projectId", "ownerId") REFERENCES "ArticleDraftSpace"("projectId", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE
);
COMMIT;
