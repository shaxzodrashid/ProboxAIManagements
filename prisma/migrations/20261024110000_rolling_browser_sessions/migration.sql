-- Additive only: existing tokens and browser deadlines retain their policy.
ALTER TABLE "User" ADD COLUMN "authRevokedAt" TIMESTAMP(3);
ALTER TABLE "SessionToken" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BrowserSession" ADD COLUMN "rolling" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BrowserSession" ADD COLUMN "authenticatedAt" TIMESTAMP(3);
ALTER TABLE "BrowserSession" ADD COLUMN "reauthFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BrowserSession" ADD COLUMN "reauthBlockedUntil" TIMESTAMP(3);
CREATE TABLE "RefreshCredential" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefreshCredential_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionToken"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefreshCredential_tokenHash_key" ON "RefreshCredential"("tokenHash");
CREATE INDEX "RefreshCredential_sessionId_idx" ON "RefreshCredential"("sessionId");
