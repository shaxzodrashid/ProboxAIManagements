-- Additive protocol baseline, not a historical edit count. Existing values stay intact.
ALTER TABLE "User" ADD COLUMN "profileRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_profileRevision_nonnegative" CHECK ("profileRevision" >= 0);

CREATE TABLE "ProfileSaveReceipt" (
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "statusRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "requestId"),
  CHECK ("actorId" = "ownerId"),
  CHECK ("expectedRevision" >= 0 AND "revision" > "expectedRevision")
);
CREATE UNIQUE INDEX "ProfileSaveReceipt_statusRequestId_key" ON "ProfileSaveReceipt"("statusRequestId");

-- Opaque monotonic generation; a command may advance it more than once.
-- Triggers cover legacy endpoints, seed/bootstrap and direct internal writers too.
CREATE FUNCTION advance_profile_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."profileRevision" := OLD."profileRevision" + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profile_content_revision BEFORE UPDATE OF "fullName", "firstName", "lastName", "bio", "birthDate"
ON "User" FOR EACH ROW EXECUTE FUNCTION advance_profile_content_revision();

CREATE FUNCTION advance_profile_related_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "User" SET "profileRevision" = "profileRevision" + 1 WHERE "id" = OLD."ownerId";
    RETURN OLD;
  END IF;
  UPDATE "User" SET "profileRevision" = "profileRevision" + 1 WHERE "id" = NEW."ownerId";
  IF TG_OP = 'UPDATE' AND NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    UPDATE "User" SET "profileRevision" = "profileRevision" + 1 WHERE "id" = OLD."ownerId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profile_policy_revision AFTER INSERT OR UPDATE OR DELETE ON "ProfileAudiencePolicy"
FOR EACH ROW EXECUTE FUNCTION advance_profile_related_revision();
CREATE TRIGGER profile_account_recipient_revision AFTER INSERT OR UPDATE OR DELETE ON "ProfileAudienceAccountRecipient"
FOR EACH ROW EXECUTE FUNCTION advance_profile_related_revision();
CREATE TRIGGER profile_workspace_recipient_revision AFTER INSERT OR UPDATE OR DELETE ON "ProfileAudienceWorkspaceRecipient"
FOR EACH ROW EXECUTE FUNCTION advance_profile_related_revision();
CREATE TRIGGER profile_status_revision AFTER INSERT OR UPDATE OR DELETE ON "ManualProfileStatus"
FOR EACH ROW EXECUTE FUNCTION advance_profile_related_revision();
