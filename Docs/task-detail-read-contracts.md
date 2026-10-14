# Existing-task detail read (TASK04 bounded prerequisite)

`GET /api/v1/tasks/:id` accepts an existing v4 task UUID and returns the existing
task read projection, with no new task or profile data: `id`, `workspaceId`,
`title`, `description`, `criteria`, `status`, `creatorId`, `managerId`, `createdAt`,
`updatedAt`, `manager: { fullName }`, and `sessions` containing zero or one
latest-created same-workspace session `{ id, status, createdAt }`. Selection is
by createdAt descending, matching the existing collection's ordering convention;
equal timestamps do not establish a complete or deterministic run order.
All existing task/session lifecycle enum values are retained. This summary is
not an active-run count and grants no session detail, transcript or action access.
No cwd, process/provider data, credentials, role grants, private profile fields,
board, project relationship, priority, deadline or checklist is included.

Requires access authentication and `tasks.read`. Inside one Repeatable Read
transaction the service rechecks current OPEN identity, caller workspace and
persisted permission grants. Without current `tasks.read-all`, only tasks whose
`managerId` matches the caller are returned. Creator identity and role labels
grant no bypass. Read-all permits workspace task reads and never another
workspace or another manager's session detail. Captured/stale service permissions
cannot preserve revoked access. Session summaries explicitly retain workspace
scope even if legacy/broken rows associate a foreign session with the task.

Missing, unassigned and foreign-workspace tasks all return the same 404
`Task not found`, without confirming existence. Missing/invalid access credentials
and non-OPEN users are rejected by the guard as 401; insufficient route permission
is 403. A captured service actor no longer OPEN, in the supplied workspace or
granted tasks.read is 403. Authorized malformed/non-v4 IDs return 400 before the
task query. Authentication dependency failure follows the sanitized 503 contract;
unexpected task-query/transaction failure retains Nest's sanitized 500 behavior.
Responses have `Cache-Control: no-store`.

Permissions and task data come from one snapshot. Changes committed after that
snapshot take effect on the next read; this does not promise immediate cancellation
of an already executing read or a retained snapshot across collection/detail.
The endpoint is read-only. Create and list response fields remain unchanged;
the list's latest-session projection receives the same workspace filter, excluding
malformed foreign-session associations while preserving well-formed results. No edit or
reassignment API, automatic task completion, new permission, or migration is added.

Tests in `test/task-project.http.spec.ts` cover assigned/read-all success and
existing projection equality, exact fields, empty latest-session summaries,
session-detail denial, missing/unassigned/foreign indistinguishability, creator
versus manager, current assignment changes, malformed IDs, authentication/grants,
stale read/read-all grants, non-OPEN/workspace mismatch and no task mutation.
`test/task-project.openapi.spec.ts` verifies the separate detail response schema
matches the existing read fields and publishes 400/401/403/404/503 outcomes.

This closes the stable-ID read capability for existing tasks. TASK04 remains
partial because its selected board/workflow/edit/assignment/deadline contracts
are unresolved. Other Task Manager, Home, profile, storage and recovery items
retain their separate status. No broader checklist closure or deployment is claimed.

## Consolidated local verification and stop point

Final source passes 579 tests in 44 suites, including 11 new task-detail HTTP
cases and all earlier authentication/profile/session/admin/storage regressions.
Typecheck, ESLint (zero warnings), Prettier, Nest build and diff checks pass.
Independent review found the malformed session association; both read filters
and the regression were rechecked with no outstanding findings. PostgreSQL
verification used only `127.0.0.1:55439/profile_test`; it was stopped afterward.

This batch changes `src/tasks/tasks.service.ts`, `src/tasks/tasks.controller.ts`,
`src/tasks/tasks.dto.ts`, `test/task-project.http.spec.ts`,
`test/task-project.openapi.spec.ts`, `README.md` and this document. No migration,
grant change, token-policy change or production configuration is required.
Earlier cumulative changes remain preserved and unstaged on main at
`31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`; nothing was committed or published.

Implementation stops here. Parent owns checklist status; the following remaining
dependencies are not approved defaults:

- Task Manager: status-management authority, initial status/palette and archive
  replacement rules; assignment cardinality, deadline date/time semantics and
  completion authority; shared-task global versus board-local workflow.
- Profiles: name requiredness/clearing, bio format/limits and audience defaults;
  avatar storage/rendition/access/retention; status symbols, audience grouping and expiry.
- Project member picker: eligible account lifecycle states and corresponding add rules.
- Recovery/storage: trusted evidence and authority for STOP_UNCONFIRMED recovery,
  enforceable writer exclusion, and intentional shared/nested department homes.
- Authentication/help: device/all-device/access-JWT/Telegram revocation scope,
  relink recovery proof and ordinary-user helper discovery.
- Conversations/Spaces/references: participant and write authority, history
  retention, shared reference/version identities and deliberate model-content inclusion.

Personal preferences, password change, precise OTP timers, cross-channel model
preferences and interactive approvals remain conditional selections. One board
per project, public names and existing contact/audience rules are already selected.
No decision here imposes mandatory last names or runner-driven human completion.
