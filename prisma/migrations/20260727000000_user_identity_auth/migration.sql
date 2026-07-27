-- Replace the provisional user lifecycle with the platform registration lifecycle.
CREATE TYPE "UserStatus_new" AS ENUM ('PENDING', 'OPEN', 'BANNED', 'DELETED');
ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "status" TYPE "UserStatus_new"
  USING (
    CASE "status"::text
      -- Legacy ACTIVE users only completed Telegram contact verification and
      -- have no platform credentials. Keep the link but require the new final
      -- registration step before opening the account.
      WHEN 'ACTIVE' THEN 'PENDING'
      WHEN 'SUSPENDED' THEN 'BANNED'
      ELSE "status"::text
    END
  )::"UserStatus_new";
DROP TYPE "UserStatus";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Pre-created identities receive credentials only after Telegram OTP verification.
ALTER TABLE "User" RENAME COLUMN "displayName" TO "fullName";
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
DROP INDEX "User_workspaceId_phoneNumber_key";
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

CREATE TYPE "AuthOtpPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET');
ALTER TABLE "AuthOtp" ADD COLUMN "purpose" "AuthOtpPurpose";
UPDATE "AuthOtp"
SET "purpose" = 'REGISTRATION',
    "consumedAt" = COALESCE("consumedAt", CURRENT_TIMESTAMP);
ALTER TABLE "AuthOtp" ALTER COLUMN "purpose" SET NOT NULL;
DROP INDEX "AuthOtp_userId_expiresAt_idx";
CREATE INDEX "AuthOtp_userId_purpose_expiresAt_idx"
  ON "AuthOtp"("userId", "purpose", "expiresAt");

CREATE TYPE "SessionTokenPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET', 'REFRESH');
ALTER TABLE "SessionToken" ADD COLUMN "purpose" "SessionTokenPurpose";
UPDATE "SessionToken"
SET "purpose" = 'REFRESH',
    "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP);
ALTER TABLE "SessionToken" ALTER COLUMN "purpose" SET NOT NULL;
ALTER TABLE "SessionToken" ADD COLUMN "consumedAt" TIMESTAMP(3);
CREATE INDEX "SessionToken_userId_purpose_expiresAt_idx"
  ON "SessionToken"("userId", "purpose", "expiresAt");
