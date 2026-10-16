# Project archival and member task visibility

Subsequent approved [human task collaboration](human-task-collaboration-contracts.md)
implements assignments, comments, checklist completion and movement. References
below to those capabilities as pending describe this earlier checkpoint.

This bounded local batch implements the approved retention rule and human task
read prerequisites. It supersedes assignment-only reads and deletion with a
separate task archive. Ownership means persisted `Project.creatorId` /
`Task.creatorId`; execution `Task.managerId` remains separate. Human assignment,
comments, checklist completion and task movement remain approved subsequent work,
not new product questions or completed capabilities.

## Archive lifecycle

`POST /projects/:projectId/archive` requires current `projects.archive` and project
creator ownership. No role label/read-all/manage-all bypasses ownership. Body:
`{requestId: UUIDv4}`; quoted `If-Match` supplies the archive revision. State and
outcome commit atomically. Identical identity, authorized owner and original
revision return the saved outcome after archival. Changed identity/revision
conflicts never repeat work. Response:
`{projectId, requestId, actorId, revision, archivedAt, createdAt}`.

Archival preserves records, files, membership, tasks, deadlines and history.
`archivedAt` is authoritative independently of historical setup `Project.status`.
Project responses publish `archivedAt` and `archiveRevision`. Ordinary
`GET /projects` excludes archives; `GET /projects?lifecycle=archived` returns only
archives with the same current read scope and ordering. Other filter values reject.
Archived detail remains readable. No restore/unarchive action is established or
added, and ordinary PUT cannot clear archival.

New project mutations reject archived/deleting projects. Board configuration and
linked deadline changes reject archival; matching prior requests remain readback.
Selected-project and manual execution cannot start or accept new turns inside
archived directories. Existing execution-manager and file access rules remain;
human task membership grants neither capability.

Archive refuses unfinished project/file callbacks, pending deletion decisions,
active initialization and active/stop-unconfirmed workspace execution. The workspace
restriction is conservative because legacy manual sessions lack authoritative
links. Cancelled/failed initialization also blocks archive where physical child
settlement cannot be proven from the existing model. These are operational safety
boundaries, not assumptions that terminal database status proves a stopped process.

## Concurrency and uncertain outcomes

Existing project mutations admit through a short workspace-locked check and a
committed `ProjectLifecycleExecution` fence before their callback. Archive checks
the same fences under that lock. Connections are not held over ordinary callbacks;
existing journal concurrency/readback remains available. Archive identities also
share a project advisory lock. Successful settlement or known client HTTP failures
may finish a fence. Dependency failures, timeouts, lost acknowledgements and failed
fence completion retain it. Neither age nor an HTTP error proves work stopped.
Existing file-operation execution fences remain independently authoritative.
Unknown outcomes require verified operational reconciliation; no force-clear API
is added. AsyncLocalStorage exempts only the caller's own execution from an empty
project deletion check; competing unfinished executions still block deletion.

Session creation and turn admission/claim/spawn checks acquire workspace admission
before task/session locks. Archive and execution cannot both pass stale checks.
Archived selected/manual directory validation repeats before execution. Previously
accepted request readback remains available.

## Contextual deletion

Deletion must prove emptiness before request, approval, session decision or token
confirmation effects. Context includes nonempty description/applied template,
deliberate workflow links, board history, initialization attempts, selected session
history, file operation/trash history, unsettled callbacks, legacy cwd evidence and
directory contents. Default board columns and initial creator membership alone do
not create task/content history. Unsafe, missing, symlinked or unreadable paths
block deletion; inspection never creates directories. Cwd is blocking evidence,
never an inferred task link.

The final DELETING transition repeats all context checks under the workspace lock.
Contextual deletion returns409 before token attempts, interruption, lifecycle/audit
changes or filesystem movement. Proven empty projects retain the owner/token flow.
Expired trash cleanup excludes archives and rechecks admission. Background project
quarantine purge requires new `snapshot.contextFreeVerified` proof and absence of
the Project row. Legacy pending quarantines without proof are retained for recovery.

## Human reads

`GET /projects/:projectId/tasks` and
`GET /projects/:projectId/tasks/:taskId` require authentication, current OPEN
account/workspace and persisted project membership. Membership is sufficient;
task permission and assignment are unnecessary. Public access, creator labels and
legacy execution read-all do not substitute. Archived tasks remain readable.
Scope/state/projection share a repeatable-read snapshot. UUIDv4 paths and no-store
responses apply. Missing/foreign/nonmember scope is404; JWT rejection remains401.

Only deliberate `TaskBoardEntry` links are read; no historical links are inferred.
Projection: `{id, projectId, title, description, ownerId, statusId, deadline,
projectArchivedAt, createdAt, updatedAt}`. No execution criteria/status, manager
details, sessions/transcripts, paths or secrets. Original task/session/file APIs
retain their established read boundaries.

## Migration and evidence

Additive migrations `20261013020000_project_archive` and
`20261013030000_project_lifecycle_execution_fence` add nullable archival state,
revision0 defaults, immutable outcomes and execution fences. Historical projects
stay active. No history/task links or grants are inferred. `projects.archive` adds
only a definition; built-in defaults exclude it and bootstrap preserves explicit
new grants. Catalogue now has31 keys. Apply migrations before code; normal DDL
locks apply. Rollback must retain archival state/history and must not re-enable old
contextual purge. No production migration or live grant change occurred.

Separate upgrade fixtures verified every legacy Project value, whole Task/User
rows and all RolePermission rows before/after both migrations, null/0 archive
defaults and no inferred records. All24 migrations also applied to a clean isolated
database. Interrupted fixtures remain recoverable in
`profile_test_archive_checkpoint_20261013`; the upgrade database is separate.

New integration tests cover membership/projection, foreign/public/admin boundaries,
filters, ownership/grants/bootstrap, retries/revisions/rollback, races/revocation,
archived execution/mutations, delayed/unknown fences and legacy quarantine retention.
Journal fault tests still inject at actual prepare/complete/timeout boundaries.
Old contextual deletion tests now enforce refusal rather than owner interruption;
DELETING tests preserve reads and reject new mutations. Final 2026-10-13 aggregate:
691 tests across 48 suites passed, including 24 new archive/member-read cases.
Type checking, ESLint, Prettier, Nest build, Prisma validation, empty database/schema
diff and `git diff --check` passed. Independent gate review has no outstanding
actionable findings. Work remains unstaged on `main` at
`31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`; existing work is preserved. No stage,
commit, push, deployment or production migration occurred.

TASK02/04/05 and full Task Manager integration remain partial. Subsequent action
APIs must enforce owner detail edits, assignment-controlled comments/checks/moves,
and exactly one checklist assignee with assignee-only completion. Human movement
must never write runner `Task.status`.

## Exact changed files

- `prisma/schema.prisma`
- `prisma/migrations/20261013020000_project_archive/migration.sql`
- `prisma/migrations/20261013030000_project_lifecycle_execution_fence/migration.sql`
- `prisma/bootstrap-role-permissions.ts`
- `src/authorization/permission.catalog.ts`
- `src/projects/project-archive.controller.ts`
- `src/projects/project-archive.dto.ts`
- `src/projects/project-archive.service.ts`
- `src/projects/project-lifecycle-lock.ts`
- `src/projects/projects.service.ts`
- `src/projects/projects.controller.ts`
- `src/projects/projects.dto.ts`
- `src/projects/projects.module.ts`
- `src/projects/project-initialization.service.ts`
- `src/sessions/sessions.service.ts`
- `src/tasks/human-tasks.controller.ts`
- `src/tasks/human-tasks.dto.ts`
- `src/tasks/human-tasks.service.ts`
- `src/tasks/tasks.module.ts`
- `src/tasks/task-boards.service.ts`
- `src/tasks/task-deadlines.service.ts`
- `test/project-archive-human-tasks.http.spec.ts`
- `test/projects.service.spec.ts`
- `test/session-deletion.http.spec.ts`
- `test/task-project.http.spec.ts`
- `test/file-deletion-journal.persistence.spec.ts`
- `test/fixtures/project-archive-upgrade-before.sql`
- `test/fixtures/project-archive-upgrade-after.sql`
- `Docs/project-archive-human-task-contracts.md`
- `Docs/task-board-status-contracts.md`
- `Docs/task-deadline-contracts.md`
- `README.md`
