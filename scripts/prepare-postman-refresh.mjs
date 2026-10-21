// Prepare documentation artifacts only. This script has no network client and
// never reads credentials, environments or saved remote request bodies.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
const root = new URL("../Docs/api/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const operations = read("postman-operation-docs.json");
const result = read("postman-refresh-20261018-result.json");
const spec = read("openapi.json");
assert.equal(operations.length, 172);
assert.equal(new Set(operations.map((o) => o.key)).size, operations.length);
assert.equal(result.workspaceId, "d69d0c23-a314-4ec5-95fc-3146146fa2f7");
assert.equal(result.visibility, "personal");
assert.equal(result.team, null);
assert.equal(spec.info.version, result.sourceVersion);
const byKey = new Map(operations.map((o) => [o.key, o]));
const existingKeys = new Set(result.existingRequests.map((r) => r.key));
for (const row of result.existingRequests) assert(byKey.has(row.key), row.key);
const missing = operations.filter((o) => !existingKeys.has(o.key));
assert.equal(missing.length, 12);
const begin = "<!-- proboxai-local-contract:start -->";
const end = "<!-- proboxai-local-contract:end -->";
const groups = new Map();
for (const operation of operations) {
  let group = groups.get(operation.collection);
  if (!group) {
    group = { name: operation.collection, item: [] };
    groups.set(operation.collection, group);
  }
  group.item.push({ name: operation.name, request: operation.request });
}
const snapshot = {
  info: {
    name: "ProboxAI locally tested 172-operation reference — deployment unverified",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description:
      "Offline source-derived reference for the current 0.3.0-dev.10 local patch. Deployment is unverified. Select a verified target and supply actual IDs, revision and credentials before deliberate execution. No request was run by artifact preparation. Do not bulk-import into the existing workspace: use the documentation-only refresh plan to preserve existing IDs, scripts, examples and user execution settings. Placeholder variables are intentionally unset; no environment or remote request credentials are exported.",
  },
  item: [...groups.values()],
  variable: [{ key: "base_url", value: "", type: "string" }],
};
const plan = {
  status: "PREPARED_BLOCKED_BY_AUTOMATIC_APPROVAL_REVIEW",
  workspaceId: result.workspaceId,
  expectedVisibility: result.visibility,
  expectedTeam: null,
  sourceVersion: result.sourceVersion,
  sourceBase: result.sourceBase,
  sourceOperations: operations.length,
  sourceSha256: Object.fromEntries(
    ["openapi.json", "postman-operation-docs.json"].map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL(name, root)))
        .digest("hex"),
    ]),
  ),
  approvedScope:
    "Documentation synchronization only. Direct user approval has been supplied, but automatic approval review still rejects continuation. This plan is not permission to bypass that block. Resolve approval-review recognition before further writes.",
  sourceDescriptions: "postman-operation-docs.json",
  markerMerge: {
    begin,
    end,
    replaceOnlyMarkedBlockWhenPresent: true,
    preserveAllTextOutsideMarkers: true,
    onFirstUpdate:
      "Prepend marked current source description. Retain the complete existing description in a clearly labelled historical details section below; do not discard possible user notes.",
  },
  beforeEachWrite:
    "Freshly read the workspace/collection/request. Match current normalized method/path and collection ID. Skip an already matching marked contract; preserve user edits outside the block. If a missing route was added meanwhile, update its documentation instead of creating a duplicate.",
  preserve:
    "Existing request IDs/names/folders, URL/method/auth/headers/body, scripts, all saved examples, collection variables/auth/events, all environment values, visibility/sharing. No application requests, monitors, public publishing, credential creation or deployment.",
  updateExisting: result.existingRequests.map((row) => ({
    collection: row.collection,
    collectionId: row.collectionId,
    requestId: row.id,
    sourceKey: row.key,
    confirmedAppliedAtReadback: result.updated.some(
      (u) => u.requestId === row.id,
    ),
    fieldsAllowedToUpdate: ["description"],
  })),
  addMissing: missing.map((operation) => {
    const collection = result.collections.find(
      (c) => c.name === operation.collection,
    );
    assert(collection);
    return {
      collection: operation.collection,
      collectionId: collection.uid.replace(/^\d+-/, ""),
      sourceKey: operation.key,
      preferredNewFolder: "Verified local API additions — 0.3.0-dev.10",
      item: {
        name: operation.name,
        request: {
          ...operation.request,
          description:
            begin + "\n" + operation.request.description + "\n" + end,
        },
      },
    };
  }),
  afterWriteVerification:
    "Read back all ten collections and workspace. Require 172 unique local method/path keys and expected 173 saved requests (the existing webhook pair remains); compare all original execution fields, IDs, scripts and 114 saved response payloads. Verify latest marked descriptions, embedded refs, If-Match quoting and optional upload flags. Report any concurrent additions separately. Keep deployment unverified.",
};
assert.equal(plan.updateExisting.length, 161);
assert.equal(
  plan.updateExisting.filter((r) => r.confirmedAppliedAtReadback).length,
  result.descriptionsUpdated,
);
for (const [name, value] of [
  ["postman-current-local.collection.json", snapshot],
  ["postman-refresh-20261018-plan.json", plan],
]) {
  writeFileSync(
    new URL(name, root),
    await format(JSON.stringify(value), { parser: "json" }),
  );
}
console.log(
  `Prepared offline 172-operation reference and exact ${result.pendingExistingDescriptions}-update/${missing.length}-addition continuation plan. No network calls or environment reads.`,
);
