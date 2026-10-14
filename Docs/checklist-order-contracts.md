# TASK05 checklist ordering — October 14

The approved TASK05 acceptance requires reordering without changing item identity.
Source audit found append order and delete/repack already implemented, but no
explicit reorder action. This increment closes that backend subset independently
of conversation policy. TASK05 remains partial overall; the parent owns Space
checklist status.

## Contract

`PUT /api/v1/projects/:projectId/tasks/:taskId/checklist/order`

```json
{
  "requestId": "client UUIDv4",
  "itemIds": ["every current item UUIDv4, in desired order"]
}
```

Supply quoted `If-Match` with the current human-task revision. The actor must be
the current OPEN task creator, have `tasks.checklists.manage`, belong to the same
workspace and remain a current project member. Assignment, execution management,
ADMIN/read-all/manage-all do not replace these conditions. Fresh checks and item
selection occur under the existing workspace transaction lock. Archived/deleting
projects reject new actions. The response uses the existing no-store human
mutation outcome: `taskId`, `requestId`, `actorId`, `action`, `revision`, `before`,
`after`, nullable `comment`, `createdAt`. Action is `CHECKLIST_REORDER`.

`itemIds` is required, accepts at most 200 unique UUIDv4 values and must include
every current item exactly once. Order is significant. Empty is valid only for an
empty checklist. Unknown/foreign item IDs produce the same 404 without disclosing
their scope. Missing current items produce 409; malformed/duplicate IDs produce 400. UUID casing is normalized without sorting the requested order. Unknown
fields are rejected. A stale shared human revision conflicts with concurrent
completion, item definition/deadline edits, additions or removals instead of
overwriting them. The usual 428 missing/400 malformed revision errors apply.

The write temporarily moves existing positions out of their unique slots, then
assigns consecutive positions 0..N-1. Both phases, human revision and immutable
before/after audit commit in one transaction. Failure rolls everything back.
Item IDs, titles, assignees, deadlines, completion attribution and creation times
are preserved; item modification timestamps may advance. Task scalars, execution
manager/status, task deadline and sessions are unchanged. An unchanged order or
empty-list request is an explicit audited action and advances one human revision.

The established durable request identity includes the original ordered list and
revision. An identical authorized retry returns its frozen outcome without
another write; changed order under the same identity conflicts. Saved outcomes
can reconcile after archival; fresh membership/permission/ownership are still
required for mutation retries. Current member readback/history uses existing GET
routes. No stream, notification, agent execution or external integration starts.

## Compatibility and verification

No schema change, migration, role grant or existing endpoint response-shape change.
Existing create/delete/completion/deadline routes and saved actions remain intact.
Clients using the new action must send the complete currently read ID list and
handle revision conflicts by rereading. They must tolerate the new audit action
name. This is ordering within one task, not cross-task transfer or workflow moves.

Independent read-only review found no actionable findings. New HTTP/PostgreSQL
tests cover whole-item preservation, normalized replay, changed-order request
conflicts, incomplete/foreign/invalid input, empty list, authority, simultaneous
completion, archive gates and rollback during the second final-position write.
Final verification: **767 tests passed in 49 suites**, including the focused
**76 HTTP/database tests** and **14 new ordering cases**. TypeScript, ESLint,
Prettier, Nest build and git diff checks passed. The initial compile-only run
reported nullable callback capture; that was corrected before the passing focused
and full runs. Final independent review found no outstanding findings. The staged
patch fingerprint remained unchanged. The isolated PostgreSQL cluster was stopped
and preserved after testing.

Changed files in this increment:

- `src/tasks/human-task-actions.controller.ts`
- `src/tasks/human-task-actions.service.ts`
- `src/tasks/human-tasks.dto.ts`
- `test/human-task-actions.http.spec.ts`
- `Docs/checklist-order-contracts.md`
- `README.md`

The earlier deadline batch and staged cumulative work are preserved. This increment
is unstaged, with no commit, push, deployment or production change. CONV01/02 stay
blocked on conversation/agent foundations and pending product decisions; no
single/multiple emoji, invitation or history-visibility policy is selected here.
