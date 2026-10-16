# TASK04 opt-in task creation recovery — 16 October 2026

Available since local `0.3.0-dev.5`. TASK04 on the authoritative API Feature Gaps
page selects uncertain-save reconciliation without duplicate tasks. The existing
POST `/api/v1/tasks` created another Task for every retry, with no request identity
or creation receipt. This batch closes that legacy task-creation recovery subset.
It does not invent atomic project-task creation, board association, assignment,
agent delegation or a complete TASK04 closure.

## Request, replay and readback

POST `/api/v1/tasks` accepts an optional client-generated UUIDv4 `requestId`.
Reuse the original ID and payload after an unknown transport/server outcome.
The first accepted request returns the existing201 `TaskResponseDto`; identical
retries return that same frozen initial response with201, without another task.
Changed input under the same owner/workspace/key returns409. A new key denotes
a new intentional creation, not a recovery attempt.

Request UUID casing is canonicalized. The input fingerprint includes a version,
exact title/description text and criteria, treating omitted/null criteria alike
because both store null. Whitespace and literal markup-looking text are preserved.
Existing limits remain240/16000/8000 characters; no new required name, trimming
or blank policy is introduced. Explicit null/malformed requestId rejects400,
rather than silently falling back to non-idempotent creation. Ownership, workspace,
manager, lifecycle, grants and unknown body fields remain unwritable through this
DTO. Omitting requestId preserves legacy deliberate non-idempotent creation.

GET `/api/v1/tasks/creations/:requestId` returns the same frozen TaskResponseDto
with200. It accepts no query selectors. It precedes UUID task-detail routing.
Both POST/readback are no-store. The receipt exposes exactly the existing ten
task creation fields, never the private input hash or ledger metadata. Current
task edits/status changes do not rewrite the receipt or replay; refresh an
independently authorized task read for current state. Invalid/inconsistent stored
receipt scope fails unavailable; extra stored internal fields are not projected.

## Authority and transaction boundary

Both keyed and legacy creation require the current OPEN account, current workspace
and persisted tasks.create inside the write transaction, after acquiring the same
workspace lock used by permission/lifecycle writers. Keyed creation atomically
writes the task and receipt. Concurrent identical requests converge; competing
different inputs yield one accepted creation and a conflict. Receipt persistence
failure rolls back the task. An error after commit does not establish rollback;
read back or retry the unchanged request.

Readback rechecks current OPEN/workspace/tasks.create with the receipt in one
RepeatableRead snapshot. tasks.read is not required for create-only recovery.
Actor/workspace scope is server-derived; other creators, foreign workspaces and
unknown requests uniformly return404, without role-name/read-all/admin bypass.
Both readback and replay refuse a task now outside the receipt's workspace.
Creation permission loss returns403; invalid/inactive HTTP authentication retains
the existing401 behavior. Dependency/corrupt-receipt failures return sanitized503
`TASK_CREATION_UNAVAILABLE`, without database detail or inferred success.

The creator remains the existing execution manager and runner Task.status starts
QUEUED. No human assignee, board link, session, process, provider call, notification
or agent identity is created. The legacy controller's ambiguous word "assignee"
is clarified to execution manager; its persisted behavior is preserved.

## Migration, retention and compatibility

`20261016000000_task_creation_receipts` adds one table with composite
workspace/creator/request primary key, unique task reference, input fingerprint,
frozen JSON object and timestamp. Foreign keys bind the workspace, same-workspace
creator and task. No existing task/profile/grant value is rewritten; historical
tasks do not receive fabricated request IDs or receipts. Prisma relation additions
do not add scalar columns to the existing Task/User/Workspace tables.

Receipt lifetime follows retained task data, matching existing task audit cascade
behavior. Actual database deletion cascades the receipt, so replay is not promised
after deletion. No new public delete/purge or receipt-expiry policy is introduced;
existing linked-task purge safeguards remain. Workspace transfer is not a new
supported feature; moved task scope is concealed, and a frozen identity/scope
mismatch fails closed rather than being rewritten for another tenant.

Apply the additive migration before keyed writers. Normal PostgreSQL DDL locks
apply. Old writers retain no-key behavior and may reject the new field; after an
unknown keyed outcome, never downgrade the retry by dropping its request ID.
Code rollback can leave the additive receipt table intact. Dropping it would erase
recovery evidence; do not treat that as a routine rollback. Old binaries cannot
honor keyed recovery. No production migration, grant, deployment or push occurred.

## Verification evidence

`test/task-creation.http.spec.ts` exercises six-way concurrent identical requests,
concurrent changed input, actual committed-create/lost-HTTP-ack injection, canonical
UUID/criteria handling, exact text, legacy no-key behavior/defaults, create-only
readback, other-owner/foreign/role bypass denial, revoked grants and all inactive
states, edited-task replay, moved task concealment, receipt-write rollback,
allowlisted/corrupt stored receipts, forged selectors and OpenAPI.
`test/task-project.http.spec.ts` supplies existing creation/read regressions.
Initial focused verification passed59 tests before the extra corrupt-receipt case;
one initial fixture enum was corrected from SUCCEEDED to repository COMPLETED.
Final cumulative results accompany the delivered checkpoint.

The existing isolated profile_test database now has29 applied migrations and an
empty Prisma schema diff. A separate preserved profile_board_upgrade_test applied
the new migration over28 previous migrations. Before/after SQL fixtures assert
unchanged complete Task/User/RolePermission row digests and zero inferred receipts,
retaining `isolated_task_creation_upgrade_evidence` alongside prior evidence tables.
A new empty profile_creation_fresh_test applied all29 migrations successfully.
Only guarded local PostgreSQL at127.0.0.1:55439 was used; none was reset or dropped.

README edits and the separately uncommitted linked-agent assessment remain
unchanged. Future delegated creation must add trusted actual-agent/owner-instruction
provenance deliberately; a request ID or receipt is not agent authority.
