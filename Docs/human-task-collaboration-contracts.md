# Human task collaboration — October 13 approved increment

The subsequent [checklist item deadline increment](checklist-item-deadline-contracts.md)
adds optional item deadlines. The pending-deadline references below describe this
earlier checkpoint; its route and permission boundaries remain in effect.

This milestone implements multiple task assignees, one assignee per checklist
item, assignment-gated comments and movement, and owner-only title/description
editing. Project membership is sufficient for human reads. Ownership means
persisted `Task.creatorId`; runner `Task.managerId` is independent.

## Routes and authority

All routes below share `/projects/:projectId/tasks/:taskId`. Mutations require
an OPEN actor, current workspace and project membership, and the listed explicit
permission. No ADMIN label or read-all grant replaces ownership or assignment.

| Method / suffix                                     | Permission                  | Additional authority / behavior                                    |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| POST `/link`                                        | `tasks.create`              | Owner; explicit same-board status; first human assignment is owner |
| PATCH `/details`                                    | `tasks.details.manage`      | Owner; title and description only                                  |
| PUT `/assignees`                                    | `tasks.assignees.manage`    | Owner; replace the set, maximum 100                                |
| PUT `/workflow-status`                              | `tasks.workflow.move`       | Current task assignee; same-board status                           |
| POST `/checklist`                                   | `tasks.checklists.manage`   | Owner; explicit item UUID and exactly one task assignee            |
| PATCH `/checklist/:itemId`                          | `tasks.checklists.manage`   | Owner; title / assignee only                                       |
| DELETE `/checklist/:itemId`                         | `tasks.checklists.manage`   | Owner; retain removal in audit, repack ordering                    |
| PUT `/checklist/:itemId/completion`                 | `tasks.checklists.complete` | Task assignee who is also that item's assignee                     |
| POST `/comments`                                    | `tasks.comments.create`     | Current task assignee; append-only plain text                      |
| GET `/comments`, `/audit`, `/operations/:requestId` | Current membership          | Safe paged history or saved outcome; no assignment required        |

Legacy `POST /tasks` remains available. Linking is deliberate and does not infer
project associations or assignments for historical tasks, permit project transfer,
or alter runner task status, manager, sessions or worker state. Human movement
updates the board entry only. Removing an occupied status additionally requires
current project membership, `tasks.workflow.move`, and assignment to every affected
task; every moved task receives a human revision and audit in the same transaction.

New assignees must be OPEN users in the same workspace and current project members.
Existing inactive assignments may temporarily remain for an explicit checklist
handoff, but confer no action authority. An assignee cannot be removed while a
checklist item still references them. Reassign or remove those items first.
Reassignment preserves existing completion attribution; it does not claim that
the new assignee completed the item. Check/uncheck requires the current item
assignee and sets/clears completion attribution and time.

Linked task deadline editing also requires task ownership and current project
membership, with `tasks.deadlines.manage`. Unlinked execution tasks retain their
existing manager rule. Assignment or execution management cannot bypass linked
task ownership.

## Revisions, recovery and safe responses

Mutation DTOs allowlist fields and require a UUID request identity and quoted
`If-Match` human revision. Link starts at revision zero. Canonical input hashing
normalizes UUIDs, trimmed text, assignee ordering and object keys. Matching retries
return the saved outcome after fresh authority checks; changed reuse or stale
revision returns conflict. State, comment and immutable audit commit atomically.
Workspace locking coordinates permission, membership, assignment and archive
changes. Archived/deleting projects reject new mutations. Authorized saved outcome
readback remains available; history snapshots describe their original revision.

Human projections contain IDs, title, description, owner, status, revision,
assignee IDs, checklist definitions/completion, deadline, archival state and
timestamps. Audit outcomes contain before/after snapshots and the user-authored
comment, never the private input hash. No execution prompts, provider payloads,
session transcripts, attachments or generated output are imported. Comment text
is literal plain text (including any HTML-looking text); clients must escape it
when rendering. History supports exclusive `afterRevision` and limit 1–100,
default 50. Checklist limits are 200 items / 200 title characters; comment limit
is 4,000 characters. No notification or external integration was introduced.

## Migration and verification

`20261013040000_human_task_collaboration` is additive and transactional: five
tables (`TaskHumanState`, `TaskAssignee`, `TaskChecklistItem`, `TaskComment`,
`TaskHumanAudit`), indexes, foreign keys and consistency constraints. Six permission
definitions bring the catalogue to 37. No role grants, legacy task linking,
assignment inference, or existing Task/User/Project scalar changes are performed.
The migration requires the preceding 24 migrations. No production migration was
applied and no down migration or destructive rollback is supplied.

Isolated PostgreSQL upgrade fixtures verified unchanged complete legacy Task,
User and Project rows, role grants and workflow statuses, with all new collaboration
tables and board entries empty immediately after upgrade. Prisma validation and
schema-to-database diff passed. All 740 tests in 49 suites passed; TypeScript,
ESLint, Prettier and Nest build passed. The new HTTP/PostgreSQL suite has 49 cases,
covering owner/assignment/key boundaries, fresh authorization races, archive
races, durable retry, lost response recovery, transactional rollback, safe
projection, inactive-assignee handoff and linked deadline authority. Independent
read-only review reported no actionable findings.

These backend subfeatures are complete locally. TASK02 / TASK04 / TASK05 remain
partial umbrellas pending their remaining UI and other scoped work. The parent
owns Space checklist status. Checklist deadlines, attachments, notifications and
cross-project transfer have not been added by this increment.

## Exact files changed in this increment

- `prisma/schema.prisma`
- `prisma/migrations/20261013040000_human_task_collaboration/migration.sql`
- `src/authorization/permission.catalog.ts`
- `src/tasks/human-task-state.ts`
- `src/tasks/human-task-actions.controller.ts`
- `src/tasks/human-task-actions.service.ts`
- `src/tasks/human-tasks.dto.ts`
- `src/tasks/human-tasks.service.ts`
- `src/tasks/tasks.module.ts`
- `src/tasks/task-boards.service.ts`
- `src/projects/projects.service.ts`
- `src/openapi/api-docs.ts`
- `src/tasks/task-deadlines.service.ts`
- `src/tasks/task-deadlines.controller.ts`
- `test/human-task-actions.http.spec.ts`
- `test/task-boards.http.spec.ts`
- `test/project-archive-human-tasks.http.spec.ts`
- `test/fixtures/human-task-upgrade-before.sql`
- `test/fixtures/human-task-upgrade-after.sql`
- `Docs/human-task-collaboration-contracts.md`
- `Docs/project-archive-human-task-contracts.md`
- `Docs/task-board-status-contracts.md`
- `Docs/task-deadline-contracts.md`
- `README.md`
