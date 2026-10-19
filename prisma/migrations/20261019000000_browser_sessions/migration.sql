-- Additive only. Existing bearer tokens and account rows are unchanged.
CREATE TABLE "BrowserSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "workspaceId" TEXT,
  "refreshId" TEXT,
  "bundle" TEXT NOT NULL,
  "csrfHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idleExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "BrowserSession_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "SessionToken"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BrowserSession_identity_check" CHECK (
    ("userId" IS NULL AND "workspaceId" IS NULL AND "refreshId" IS NULL) OR
    ("userId" IS NOT NULL AND "workspaceId" IS NOT NULL AND "refreshId" IS NOT NULL)
  )
);
CREATE INDEX "BrowserSession_absoluteExpiresAt_idx" ON "BrowserSession"("absoluteExpiresAt");
CREATE INDEX "BrowserSession_refreshId_idx" ON "BrowserSession"("refreshId");
