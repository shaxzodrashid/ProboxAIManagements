// Isolated upgrade preservation evidence. Never reads the application's DATABASE_URL.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.PROFILE_TEST_DATABASE_URL ?? "");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  url.pathname !== "/profile_test"
)
  throw new Error("Requires isolated localhost profile_test");
const schema = "profile_upgrade_" + randomUUID().replaceAll("-", "");
const root = new URL("../prisma/migrations/", import.meta.url);
const target = "20261016020000_atomic_profile_save";
const read = (name) =>
  readFileSync(new URL(name + "/migration.sql", root), "utf8")
    .replace(/^BEGIN;\s*$/gm, "")
    .replace(/^COMMIT;\s*$/gm, "");
const migrations = readdirSync(root)
  .filter((name) => /^\d/.test(name) && name < target)
  .sort();
const sql = `BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}", public;
${migrations.map(read).join("\n")}
INSERT INTO "Workspace" ("id", "slug") VALUES ('upgrade-w', 'upgrade-w');
INSERT INTO "User" ("id", "workspaceId", "phoneNumber", "fullName", "firstName", "bio", "birthDate", "status", "updatedAt")
VALUES ('upgrade-owner', 'upgrade-w', 'upgrade-fixture', 'Legacy  Multi Word Name', NULL, 'Private old bio', '2000-02-29', 'OPEN', CURRENT_TIMESTAMP);
INSERT INTO "ProfileAudiencePolicy" ("ownerId", "field", "mode", "updatedAt") VALUES ('upgrade-owner', 'BIO', 'CUSTOM', CURRENT_TIMESTAMP), ('upgrade-owner', 'STATUS', 'NO_ONE', CURRENT_TIMESTAMP);
INSERT INTO "ProfileAudienceAccountRecipient" ("ownerId", "field", "accountId") VALUES ('upgrade-owner', 'BIO', 'upgrade-owner');
INSERT INTO "ManualProfileStatus" ("ownerId", "availability", "revision") VALUES ('upgrade-owner', 'BUSY', 7);
INSERT INTO "ManualProfileStatusMutation" ("ownerId", "requestId", "workspaceId", "actorId", "expectedRevision", "revision", "before", "availability")
VALUES ('upgrade-owner', 'old-receipt', 'upgrade-w', 'upgrade-owner', 6, 7, 'AWAY', 'BUSY');
CREATE TEMP TABLE profile_before ON COMMIT DROP AS SELECT row_to_json(u) AS value FROM "User" u;
CREATE TEMP TABLE policies_before ON COMMIT DROP AS SELECT jsonb_agg(to_jsonb(p) ORDER BY p.field) AS value FROM "ProfileAudiencePolicy" p;
CREATE TEMP TABLE status_before ON COMMIT DROP AS SELECT row_to_json(s) AS value FROM "ManualProfileStatus" s;
CREATE TEMP TABLE receipts_before ON COMMIT DROP AS SELECT row_to_json(m) AS value FROM "ManualProfileStatusMutation" m;
${read(target)}
DO $$ BEGIN
IF (SELECT to_jsonb(u) - 'profileRevision' FROM "User" u) IS DISTINCT FROM (SELECT value::jsonb FROM profile_before) THEN RAISE EXCEPTION 'User content changed'; END IF;
IF (SELECT "profileRevision" FROM "User") <> 0 THEN RAISE EXCEPTION 'Bad protocol baseline'; END IF;
IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.field) FROM "ProfileAudiencePolicy" p) IS DISTINCT FROM (SELECT value FROM policies_before) THEN RAISE EXCEPTION 'Policies changed'; END IF;
IF (SELECT row_to_json(s)::jsonb FROM "ManualProfileStatus" s) IS DISTINCT FROM (SELECT value::jsonb FROM status_before) THEN RAISE EXCEPTION 'Status changed'; END IF;
IF (SELECT row_to_json(m)::jsonb FROM "ManualProfileStatusMutation" m) IS DISTINCT FROM (SELECT value::jsonb FROM receipts_before) THEN RAISE EXCEPTION 'History changed'; END IF;
IF (SELECT count(*) FROM "ProfileAudienceAccountRecipient") <> 1 OR (SELECT count(*) FROM "ProfileSaveReceipt") <> 0 THEN RAISE EXCEPTION 'Unexpected recipient or root receipt backfill'; END IF;
END $$;
ROLLBACK;`;
execFileSync("psql", [url.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-q"], {
  input: sql,
  stdio: ["pipe", "pipe", "pipe"],
});
console.log(
  "Existing-data upgrade preserved legacy names, bio, birthday, policies, recipients, availability and status receipts; revision baseline0, no root receipt backfill. Temporary schema rolled back.",
);
