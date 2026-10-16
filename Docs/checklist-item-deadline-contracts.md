# Checklist item deadlines and reaction prerequisites — October 14

## Approved independent TASK05 increment

Existing POST `/api/v1/projects/:projectId/tasks/:taskId/checklist` and PATCH
`/api/v1/projects/:projectId/tasks/:taskId/checklist/:itemId` now accept an optional
`deadline`. They retain current OPEN account, workspace/project membership,
`tasks.checklists.manage` and task creator ownership checks. Item assignment does
not authorize definition/deadline edits. All existing archive/deleting gates,
quoted `If-Match`, UUID request identity, human revision, immutable audit and
transactional recovery rules apply. No new route, permission or role grant.

Creation omission/null starts without a deadline. Edit omission preserves the
value; null clears it; an object replaces the whole value. Partial nested edits
are unsupported. The same validated [task deadline value](task-deadline-contracts.md)
is reused: real Gregorian date, years 0001–9999, optionally HH:mm plus supported
IANA timezone and explicit matching offset. Date-only values never become UTC
midnight. Timed values pin one instant, including repeated DST hours; invalid
or skipped local times are rejected. There are no implicit defaults, reminders,
overdue/completion rules, provider calls or notifications.

Each current checklist item response adds nullable `deadline` with the existing
`DeadlineValueDto` shape. Human before/after audit snapshots include the item
deadline, preserving it after removal. Historical immutable snapshots retain
their original shapes: clients must tolerate the field being absent in older
saved outcomes and interpret it as unset at that checkpoint. Current reads return
null for migrated items. Completion, attribution, item identity/order and task-level
deadline remain independent. Existing clients may omit the new input field;
strict response consumers must accommodate its additive presence. Pending request
identities without this field keep their prior fingerprint. Submitted civil values,
not timezone-derived results, define new deadline request fingerprints; fresh
authority and prior lookup precede timezone validation, so committed retries still
reconcile if runtime timezone data changes.

Migration `20261014000000_checklist_item_deadlines` transactionally adds one nullable
JSONB column to `TaskChecklistItem`; it performs no backfill, destructive change,
grant or historical inference. Apply only after the preceding 25 migrations.
Existing open/completed checklist records, full task records, task deadlines,
human audit records and role grants were compared before/after on the isolated
upgrade database and remained unchanged. No production migration was applied.

Corrected focused HTTP/value tests: 94 passed in two suites, including 13 new
cases for independent create/read/edit/clear, completion preservation, literal
calendar values, DST instant choice, invalid nested inputs, ownership/permission
scope, stale/archive gates, request replay and atomic rollback. Independent
read-only review identified and then verified the timezone replay correction;
no actionable findings remain. Final cumulative verification passed **753 tests
in 49 suites**, TypeScript, ESLint, Prettier, Nest build, Prisma schema validation,
isolated schema parity and git diff checks. The isolated PostgreSQL cluster was
stopped and preserved after verification. The staged patch fingerprint remained
unchanged throughout this increment.

TASK05 remains partial: this closes the item deadline backend subset, not the
whole UI or other remaining checklist requirements. Parent owns Space status.

## CONV02 reaction blocker

Fresh source audit found no human conversation/topic/message model or REST
module, and no authenticated agent participant identity. `TelegramConversation`
is bot UI state only; provider `codexThreadId` belongs to coding session execution.
Neither supplies authorized human message identity or conversation access.
CONV01/02 remain proposed in the source checklist. No reaction table, grants,
endpoint, counts or subscriptions were invented atop these unrelated records.

Before reactions, define invitation/cross-workspace authority, conversation and
topic history visibility, project-thread audience inheritance, participant identity
for agents, and lifecycle/retention. Recommendation: establish CONV01's authorized
membership and stable message foundation first, then attach self-owned reactions
and bounded counts/actor readback under that scope. Single versus multiple emoji
per account/message remains pending parent relay. Emoji validation/moderation and
deleted-message retention also remain source decisions. No conclusion here chooses
those policies or claims reaction closure.

## Exact files in this increment

- `prisma/schema.prisma`
- `prisma/migrations/20261014000000_checklist_item_deadlines/migration.sql`
- `src/tasks/human-task-state.ts`
- `src/tasks/human-task-actions.service.ts`
- `src/tasks/human-task-actions.controller.ts`
- `src/tasks/human-tasks.dto.ts`
- `test/human-task-actions.http.spec.ts`
- `test/fixtures/checklist-deadline-upgrade-before.sql`
- `test/fixtures/checklist-deadline-upgrade-after.sql`
- `Docs/checklist-item-deadline-contracts.md`
- `Docs/human-task-collaboration-contracts.md`
- `README.md`

The existing staged cumulative patch was observed at turn start and preserved.
This increment remains unstaged. No commit, push, deployment or production change.
