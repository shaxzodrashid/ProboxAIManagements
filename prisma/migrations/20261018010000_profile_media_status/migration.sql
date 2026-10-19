BEGIN;
CREATE TYPE "ProfileAvatarState" AS ENUM ('UPLOADING','STAGED','ACTIVE','DELETE_PENDING','DELETING','DELETED');
ALTER TABLE "User" ADD COLUMN "customStatusText" VARCHAR(300),
  ADD COLUMN "customStatusEmoji" VARCHAR(32),
  ADD COLUMN "customStatusExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "avatarAssetId" TEXT;
CREATE TABLE "ProfileAvatarAsset" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL, "inputHash" TEXT NOT NULL, "objectKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL, "size" INTEGER NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL,
  "state" "ProfileAvatarState" NOT NULL DEFAULT 'UPLOADING',
  "expiresAt" TIMESTAMP(3) NOT NULL, "uploadedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK ("size" > 0 AND "size" <= 2097152),
  CHECK ("width" > 0 AND "width" <= 512 AND "width" = "height")
);
CREATE UNIQUE INDEX "ProfileAvatarAsset_ownerId_requestId_key" ON "ProfileAvatarAsset"("ownerId","requestId");
CREATE UNIQUE INDEX "ProfileAvatarAsset_objectKey_key" ON "ProfileAvatarAsset"("objectKey");
CREATE INDEX "ProfileAvatarAsset_state_nextAttemptAt_expiresAt_idx" ON "ProfileAvatarAsset"("state","nextAttemptAt","expiresAt");
CREATE UNIQUE INDEX "User_avatarAssetId_key" ON "User"("avatarAssetId");
ALTER TABLE "User" ADD CONSTRAINT "User_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "ProfileAvatarAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE FUNCTION check_profile_avatar_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."avatarAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProfileAvatarAsset" a WHERE a."id" = NEW."avatarAssetId" AND a."ownerId" = NEW."id" AND a."state" = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'Invalid active profile avatar'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER profile_avatar_owner BEFORE INSERT OR UPDATE OF "avatarAssetId" ON "User"
FOR EACH ROW EXECUTE FUNCTION check_profile_avatar_owner();
CREATE FUNCTION check_referenced_profile_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" u WHERE u."avatarAssetId" = NEW."id" AND (u."id" <> NEW."ownerId" OR NEW."state" <> 'ACTIVE'))
  THEN RAISE EXCEPTION 'Referenced avatar cannot change ownership or retire'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER profile_avatar_reference BEFORE UPDATE OF "ownerId", "state" ON "ProfileAvatarAsset"
FOR EACH ROW EXECUTE FUNCTION check_referenced_profile_avatar();
ALTER TABLE "User" ADD CONSTRAINT "User_customStatusExpiry_content" CHECK ("customStatusExpiresAt" IS NULL OR "customStatusText" IS NOT NULL OR "customStatusEmoji" IS NOT NULL);
DROP TRIGGER profile_content_revision ON "User";
CREATE TRIGGER profile_content_revision BEFORE UPDATE OF "fullName", "firstName", "lastName", "bio", "birthDate", "customStatusText", "customStatusEmoji", "customStatusExpiresAt", "avatarAssetId"
ON "User" FOR EACH ROW EXECUTE FUNCTION advance_profile_content_revision();
COMMIT;
