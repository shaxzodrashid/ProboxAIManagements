# Project task-board/status lifecycle — October 13 decisions

The later [shared-task association foundation](shared-human-task-contracts.md)
adds additional-board associations without replacing the original task entry.
Move occupied shared entries explicitly before removing their column. Canonical
human completion is stored independently, with no inference from Done labels,
colors or runner success; its write authority remains pending clarification.

The subsequent [workflow display increment](task-workflow-display-contracts.md)
adds the same current status label/color/palette to member-only human task reads,
with frozen mutation/audit snapshots unchanged. It also aligns Unicode name
validation with the existing database limit.

Later approved retention/member-read rules supersede the open decisions below;
see [project archive and human reads](project-archive-human-task-contracts.md).
Archived projects reject new status mutations while prior request readback remains.
Task movement now requires assignment; see
[human task collaboration](human-task-collaboration-contracts.md). Occupied status
removal additionally requires current membership, movement permission and assignment
to every affected task, with each move advancing its human revision and audit.

One board per project starts with To do / In progress / Review / Done, ordered
0–3. The owner approved customizable statuses, dedicated permissions and atomic
replacement before removal on October 13. Boards are human workflow; runner-owned
`Task.status` and session status are unchanged. Initial Done is a label/color, not
an automatic runner completion rule or a global cross-project completion model.

## Permissions and scope

New definitions `tasks.boards.read` and `tasks.statuses.manage` follow the existing
permission-key catalogue. No migration or built-in role default grants either,
including ADMIN. Existing project editing, read-all, role names and creator identity
are not substitutes. Explicit grants use the existing authorization-management API.
Bootstrap preserves explicitly assigned new keys while resetting legacy defaults.
The board-only milestone expanded27 keys to29; the subsequent deadline batch
adds one more. Use the current catalogue and deadline contract when updating the
previous27-key UI explanation.

Board read requires `tasks.boards.read` plus `projects.read` and existing current
workspace project read scope (membership, public read, or projects.read-all).
Status management/edit/audit/readback require `tasks.statuses.manage` plus current
project membership or projects.manage-all. Manage-only callers may read the narrow
edit snapshot without board-read/task-read grants. No task roster, assignee,
private profile, filesystem path, runner detail or execution action is granted.
Fresh OPEN identity and persisted grants are rechecked in the transaction.
Mutations share the workspace lock with authorization/lifecycle writers and reject
DELETING projects; reads use Repeatable Read snapshots.

## HTTP contract

All routes are under `/api/v1/projects/:projectId/task-board`, no-store, UUIDv4 IDs.

| Method/path                  | Input                                              | Output                             |
| ---------------------------- | -------------------------------------------------- | ---------------------------------- |
| GET `/`                      | board-read scope                                   | `{id,projectId,revision,statuses}` |
| GET `/edit`                  | status-management scope                            | Same metadata snapshot             |
| POST `/statuses`             | requestId, name, color; If-Match                   | 201 mutation outcome               |
| PATCH `/statuses/:statusId`  | requestId, name and/or color; If-Match             | 200 mutation outcome               |
| PUT `/statuses/order`        | requestId, all statusIds exactly once; If-Match    | 200 mutation outcome               |
| DELETE `/statuses/:statusId` | requestId, replacementStatusId when used; If-Match | 200 mutation outcome               |
| GET `/operations/:requestId` | current status-management scope                    | Saved mutation outcome             |
| GET `/audit`                 | exclusive afterRevision, limit 1–100 (default50)   | items, hasMore, nextAfterRevision  |

Each status has stable id, name, color, zero-based position and resolved palette.
Names trim at boundaries, must be nonblank and at most120 characters; duplicates
are allowed because IDs are authoritative. A board retains at least one column
and supports at most100. Four verified semantic tokens use the existing Figma
palette: NEUTRAL #4d5c6c/#e8edf2, TEAL #08695f/#d9efeb, PURPLE #60318b/#e8def7,
GREEN #376b32/#dff0dc (foreground/background). Color never changes completion meaning.
Unknown/invalid persisted configuration fails unavailable, not an invented default.

Mutation outcome: requestId, revision, action, actorId, affectedTasks, before, after,
createdAt. Before/after are board metadata snapshots; hashes and task IDs are omitted.
Request IDs and project/status IDs are canonicalized at the service boundary.
Same request, actor, canonical input and original revision returns the saved outcome
without reapplying; changed reuse is409. Unknown mutation outcome requires readback
or the same request with original If-Match, never a new ID or blind stale replay.
500/503 do not prove rollback. Missing If-Match is428, malformed400, stale409.

Occupied removal requires an explicit different same-board replacement. Every
referenced TaskBoardEntry moves before status removal in the same transaction as
reindex/revision/audit. Foreign/malformed task associations refuse reconciliation;
audit persistence failure rolls all changes back. Last-column removal is409.
Removed status identities survive in audit snapshots, not active table rows.

## Migration and compatibility

Additive migration `20261013000000_task_board_statuses` creates board/status/entry/
audit tables, uniqueness/FKs/checks, permission definitions and an atomic project
insert trigger. Existing and future projects receive one board/default4 columns.
There is no historical task association or grant backfill. TaskBoardEntry is an
explicit human association, separate from cwd/Telegram/selected session context.
Composite status FK prevents cross-board assignment; occupied status deletion is
restricted. Project purge checks linked entries under the workspace lock before
lifecycle/quarantine changes. It is conservatively blocked until task retention
on project deletion is selected; no unlink/cascade policy is invented.

Normal PostgreSQL DDL locking and migration-before-app cutover are required. The
trigger covers older project inserts, but future task writers must share workspace
locking, validate workspace/project scope and reject DELETING. No production
migration or grant change occurred. Rollback may leave additive tables/trigger in
place; do not drop occupied metadata or audit history as a code rollback shortcut.

## Evidence and remaining work

30 isolated PostgreSQL HTTP/service cases cover permissions, scope, read-only/edit
snapshots, revision races, retries/canonical UUIDs, explicit bootstrap grants,
atomic move/removal/rollback, forbidden cross-scope data, audit paging, validation,
OpenAPI and purge-before-filesystem protection. Separate upgrade test applies the
20 prior migrations, inserts legacy records, applies this migration and verifies
whole-row task/project/account digests, unchanged grants, default4 and zero inferred
links (`test/fixtures/task-board-upgrade-before.sql` / `after.sql`). Schema diff is
empty. Initial cumulative gate: 609 tests /45 suites pass; type/build/format passed;
lint's unused fixture variable is corrected by exercising a real foreign-board ID.

Task queries/views, explicit task-to-board creation/linking, employee assignees
and checklists remain separate batches. Task-level deadlines are now implemented
in `task-deadline-contracts.md`. Task retention on project purge
and employee-assignee read scope need explicit choices. Existing task/session read
boundaries remain unchanged. This is a locally verified metadata/status lifecycle
capability, not complete Task Manager UI/runtime behavior or a broad checklist closure.

Final combined gate on 2026-10-13: 667 tests across 47 suites pass. Type checking,
ESLint, Prettier, Nest build, Prisma validation, empty schema diff and
`git diff --check` pass. Both additive migrations were applied to isolated local
PostgreSQL databases; the separate legacy upgrade fixture preserved whole rows
and existing grants. Independent review has no outstanding actionable findings.
See `task-deadline-contracts.md` for the exact combined batch file manifest.
