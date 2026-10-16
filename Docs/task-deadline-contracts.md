# Task deadline contracts — October 13 selected date/time behavior

Later approved retention/member-read rules supersede the open decisions below;
see [project archive and human reads](project-archive-human-task-contracts.md).
Linked archived projects reject new deadline writes; prior request readback remains.
Project members can read deadlines through the separate narrow human-task API.

The subsequent [human task collaboration](human-task-collaboration-contracts.md)
increment requires task ownership and current project membership for linked task
deadline edits/history/reconciliation, alongside `tasks.deadlines.manage`. Unlinked
execution tasks retain the manager rule described below. Ordinary execution read
scope remains unchanged; assignment alone does not authorize deadline editing.

The owner selected deadlines as a date with optional time and timezone handling.
This bounded batch implements task-level read/edit/clear, revision conflicts,
audit and request reconciliation without changing assignment, task execution
status, session scope, project associations, reminders or overdue/completion rules.
Checklist-item deadlines reuse this value contract in a later checklist batch.

## Input and timezone behavior

Replace the entire deadline or send `deadline: null` to clear. `deadline` is
required; omission is invalid. Use a real Gregorian `date: YYYY-MM-DD`, supported
calendar years0001–9999. Date-only input may omit or null the optional time fields;
non-null zone/offset requires a time. Date-only response is:

```json
{
  "kind": "DATE",
  "date": "2026-10-13",
  "time": null,
  "timeZone": null,
  "utcOffset": null,
  "instant": null
}
```

Display its stored calendar date. Do not parse it as a UTC midnight then convert
to the viewer's timezone; that would change the intended day. No end-of-day
instant or timezone is invented for date-only values.

Timed input requires `time: HH:mm`, supported IANA `timeZone` and a matching
explicit `utcOffset: ±HH:mm`. The client can derive the offset for an ordinary
local time; a repeated hour needs a deliberate occurrence selection. The server
rejects a nonexistent local time or mismatched offset rather than silently moving
it. Known offsets are bounded ±14:00; use +00:00 for UTC, not unknown -00:00.
Second-level/historical offsets not representable by this minute-precision
contract are not coerced. Validation uses the installed runtime's timezone data.

Example: 2026-10-13 17:30 Asia/Tashkent +05:00 stores
`instant: 2026-10-13T12:30:00.000Z` while retaining the submitted calendar date,
clock, resolved IANA zone and offset. New York's 2026-11-01 01:30 with -04:00 and
-05:00 selects distinct instants05:30Z and06:30Z. Spring's nonexistent02:30 rejects.
Timed display may convert the pinned instant to the viewer's timezone with an
explicit zone label; the original civil fields remain available. Existing pinned
instants are never recomputed using later timezone rules. Stored malformed values,
unsupported zone metadata and out-of-range instants fail sanitized503.

## Permission and HTTP contracts

Routes are `/api/v1/tasks/:taskId/deadline`; UUIDv4 IDs, no-store responses.

| Method/path                  | Scope                                                           | Contract                                                                       |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET `/`                      | tasks.read; current manager or current workspace tasks.read-all | taskId, revision, deadline                                                     |
| GET `/edit`                  | tasks.deadlines.manage and current task manager                 | Same narrow edit snapshot; no read grant implied                               |
| PUT `/`                      | tasks.deadlines.manage and current task manager                 | requestId, deadline; original quoted If-Match required                         |
| GET `/operations/:requestId` | Current deadline management scope                               | Saved outcome without replay                                                   |
| GET `/audit`                 | Current deadline management scope                               | Exclusive afterRevision; limit1–100/default50; items,hasMore,nextAfterRevision |

`tasks.deadlines.manage` is a new dedicated definition, not part of any built-in
role defaults, including ADMIN. Read-all and role labels never grant editing.
Bootstrap preserves explicit new grants without auto-granting them. Alongside the
board batch the permission catalogue now has30 keys: tasks.boards.read,
tasks.statuses.manage and tasks.deadlines.manage extend the legacy27. Existing
task reads and their output shapes remain unchanged; this separate endpoint uses
the established task scope. There is no employee-assignee visibility expansion.

OPEN identity, current workspace, persisted keys and manager/read scope are
rechecked in the transaction. Mutations share the workspace lock with existing
authorization/lifecycle writers. Read snapshots are Repeatable Read; changes after
the snapshot are seen next request. Missing, unassigned and foreign tasks share
the same404. Authentication rejection stays401, insufficient permission403,
invalid input/header400, missing If-Match428, stale or conflicting reuse409.

Snapshot absent/cleared deadline is null with revision0 for never-written records;
reads create no record. Each accepted explicit write/clear advances revision and
atomically appends actor/request/revision/before/after/createdAt audit evidence.
Outcome excludes hashes and unrelated task/account/runner data. Mutating a deadline
does not change `Task.status` or `Task.updatedAt`. Former managers lose edit,
audit and request-readback access even if their read-all grant still permits reads.

Same canonical UUID, actor, original revision and stable normalized original
input returns the saved outcome. Nullable optional fields and JSON key order are
normalized; timezone text is case-insensitive, but a different alias is different
input. Fingerprints do not depend on a derived instant or mutable alias/rule
resolution. Matching prior requests return after fresh authorization and before
current timezone validation, including when runtime timezone support changes.
Changed input reuse is409; new requests validate current rules. Preserve the
original body, requestId and If-Match on retry. 500/503 do not prove rollback;
reread outcome/snapshot and reconcile rather than blind replay with a new ID.

## Migration, evidence and bounded status

Additive migration `20261013010000_task_deadlines` creates task deadline/audit
tables, FKs/indexes/basic checks and the definition only. No existing task changes,
date/zone inference, deadline backfill or role grants. Deploy migration before
new code; normal DDL locks apply. Rollback can leave additive records/audits intact.
No production migration, publication or live provider call was performed.

Tests: `test/task-deadline-value.spec.ts` (32 calendar/timezone cases) and
`test/task-deadlines.http.spec.ts` (26 real HTTP/isolated PostgreSQL cases) cover
date shifts, leap/invalid dates, offsets, gaps/repeated hours, pinned storage,
read/manager/foreign scope, mass assignment, fresh grants/manager changes,
revisions/retries/rule-change replay, audit rollback/paging and OpenAPI contracts.
The board suite's30 cases remains green. Upgrade preservation fixtures additionally
verify unchanged legacy task/project/account rows, preserved old grants, zero
historical task links/deadlines and no implicit new grants.

This closes task-level deadline behavior locally, not TASK04/05 in full.
Employee-assignee read scope and task retention on project purge remain genuine
decisions before broader task linking/collaboration. Multiple-employee assignment,
single-assignee checklists, assignee-only completion and manager-only human task
status are approved requirements but not implemented by this deadline batch.
The next batch must preserve their distinction from manager-owned execution access.

## Final combined verification and changed files

2026-10-13: all 667 tests across 47 suites passed, including 30 board cases and 58
deadline cases. Type checking, ESLint, Prettier, Nest build, Prisma schema
validation, an empty database-to-schema diff and `git diff --check` passed.
Independent review has no outstanding actionable findings. Both migrations were
verified in isolated local PostgreSQL databases; the separate upgrade database
applied 20 prior migrations before legacy fixtures and then both new migrations,
preserving complete legacy rows and grants without inferred links or deadlines.

The combined board/deadline batch changed these 24 files; other pre-existing
working-tree changes were preserved:

- `prisma/schema.prisma`
- `prisma/migrations/20261013000000_task_board_statuses/migration.sql`
- `prisma/migrations/20261013010000_task_deadlines/migration.sql`
- `prisma/bootstrap-role-permissions.ts`
- `prisma/seed.ts`
- `src/authorization/permission.catalog.ts`
- `src/projects/projects.service.ts`
- `src/openapi/api-docs.ts`
- `src/tasks/tasks.module.ts`
- `src/tasks/task-boards.dto.ts`
- `src/tasks/task-boards.service.ts`
- `src/tasks/task-boards.controller.ts`
- `src/tasks/task-deadlines.dto.ts`
- `src/tasks/task-deadline-value.ts`
- `src/tasks/task-deadlines.service.ts`
- `src/tasks/task-deadlines.controller.ts`
- `test/task-boards.http.spec.ts`
- `test/task-deadline-value.spec.ts`
- `test/task-deadlines.http.spec.ts`
- `test/fixtures/task-board-upgrade-before.sql`
- `test/fixtures/task-board-upgrade-after.sql`
- `Docs/task-board-status-contracts.md`
- `Docs/task-deadline-contracts.md`
- `README.md`

Work remains unstaged on `main` at
`31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. No commit, push, deployment,
production migration or live grant change was performed. The permission catalogue
now has 30 keys; the previous 27-key UI access guide needs reconciliation.
