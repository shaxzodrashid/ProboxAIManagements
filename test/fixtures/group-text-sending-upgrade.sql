-- Representative old-row compatibility check, entirely rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA group_send_upgrade_20261020;
SET LOCAL search_path TO group_send_upgrade_20261020;
CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
CREATE TABLE "ChatGroup" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "permissionRevision" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "ChatGroupMembership" (
  "groupId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "historyAccess" TEXT NOT NULL,
  PRIMARY KEY ("groupId", "accountId")
);
INSERT INTO "User" VALUES ('synthetic-owner');
INSERT INTO "ChatGroup" VALUES ('synthetic-group', 'Legacy display text', 'synthetic-owner', 7);
INSERT INTO "ChatGroupMembership" VALUES ('synthetic-group', 'synthetic-owner', 'LAST_300');
\ir ../../prisma/migrations/20261020020000_group_text_sending/migration.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ChatGroup" WHERE "id"='synthetic-group'
    AND "name"='Legacy display text' AND "ownerId"='synthetic-owner'
    AND "permissionRevision"=7 AND "membersCanSend"=true
    AND "sendingRevision"=0 AND "lastMessageSequence"=0) THEN
    RAISE EXCEPTION 'Old group/default preservation failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ChatGroupMembership" WHERE "groupId"='synthetic-group'
    AND "accountId"='synthetic-owner' AND "historyAccess"='LAST_300') THEN
    RAISE EXCEPTION 'Admission preservation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "ChatGroupMessage") OR EXISTS (SELECT 1 FROM "ChatGroupSendingAudit") THEN
    RAISE EXCEPTION 'Migration invented content';
  END IF;
END $$;
ROLLBACK;
