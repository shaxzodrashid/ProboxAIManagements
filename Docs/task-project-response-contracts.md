# TASK 01 and PROJECT 04

Both checklist entries are implemented locally after revalidating current source
and preserved uncommitted work. No permission, database schema or lifecycle
behavior is changed by this batch. The parent owns Space checklist updates.

## TASK 01

POST `/api/v1/tasks` retains its 201 status and task scalars only, documented as
`TaskResponseDto`. GET `/api/v1/tasks` documents `TaskListItemResponseDto[]`, with
required `manager: { fullName }` and `sessions` in addition to task scalars.
Nullable criteria and all native TaskStatus/SessionStatus values are explicit.

Each sessions array contains zero or one record, selected by session createdAt
descending. The summary deliberately returns only `id`, `status`, `createdAt`.
This narrows the former undocumented all-scalar session payload: task lists no
longer expose cwd, sandbox, model selection/catalog fields, Codex thread IDs,
process IDs, execution times, counters or internal session metadata. The array
shape, ordering and documented summary fields are preserved. No repository
consumer of TasksService.list other than the HTTP controller was found; Telegram
uses its own Prisma session/task queries and is unchanged.

Existing tasks.read is still required. tasks.read-all grants workspace task-list
visibility; otherwise results remain restricted to the caller's assigned tasks.
Receiving another manager's summary does not grant session-detail access: the
session route still requires sessions.read and assigned-manager authorization.

## PROJECT 04

Project responses now use operation-specific schemas matching existing payloads:

| Operation                                  | Schema                             | Relationship behavior                                                                                                             |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST /projects (201)                       | ProjectCreatedResponseDto          | Creator, department, members required; initializations present only for templated creation                                        |
| GET /projects (200)                        | ProjectListItemResponseDto[]       | Creator, department, member count and zero-or-one latest initialization; members omitted                                          |
| GET /projects/:id (200)                    | ProjectResponseDto                 | Creator, department and zero-or-one latest initialization; members available only to project members or projects.read-all callers |
| PUT /projects/:id (200)                    | ProjectScalarResponseDto           | Project scalars only                                                                                                              |
| POST /projects/:id/members (201)           | ProjectMemberResponseDto           | Membership scalars and nested user identity                                                                                       |
| DELETE /projects/:id/members/:userId (200) | ProjectMembershipScalarResponseDto | Membership scalars only                                                                                                           |

All ProjectStatus values include DELETING. Nullable project fields have explicit
string schemas. Department metadata and initialization scalar records are typed;
initializations is correctly an array, ordered by attempt descending. Existing
initialization payload fields are retained, including nullable path/lease/error
fields; this batch adds no new runtime exposure.

Members omission is not an empty list. Clients should retain existing relational
data when merging scalar mutation responses or refresh authorized detail. Add
member's OpenAPI status is corrected from 200 to the existing runtime 201; no
HTTP status is changed. Project access and mutation authorization remain intact.

## Validation and independent review

The two new suites pass 27 checks: generated OpenAPI contracts plus real Nest
HTTP routing, DTO validation settings, persisted authentication/permissions,
Prisma projections and PostgreSQL data. They exercise all task/session/project
lifecycle values, latest-created summary selection, empty sessions, exact create
shape, task workspace/assignee scope, another manager's denied session detail,
project list/detail/update/member shapes, intentional member omission, latest
initialization arrays, cross-workspace rejection and permission-denied requests.

A separate read-only reviewer compared DTOs against Prisma models and every
relevant service projection and found no outstanding concrete findings. It did
not execute tests; execution evidence comes from the local check runs.

The final cumulative run passes **182 tests across 25 suites** with isolated
database tests enabled. Full TypeScript typecheck, ESLint, production build,
the repository-wide Prettier check and git diff whitespace checks pass. The
temporary PostgreSQL cluster was stopped after these checks. Existing profile,
template/department, authentication, authorization, Telegram and runner
regressions remain passing alongside the new response-contract tests.

Exact files added/changed in this batch:

- `src/tasks/tasks.dto.ts`
- `src/tasks/tasks.controller.ts`
- `src/tasks/tasks.service.ts`
- `src/projects/projects.dto.ts`
- `src/projects/projects.controller.ts`
- `test/task-project.openapi.spec.ts` (new)
- `test/task-project.http.spec.ts` (new)
- `Docs/task-project-response-contracts.md` (new)

Database-backed HTTP tests are opt-in via PROFILE_TEST_DATABASE_URL and enforce
the task's isolated 127.0.0.1:55439/profile_test target. The OpenAPI suite runs
without a database. No live service/database, publication or migration is used
for this batch. Existing account/profile and template/department changes remain
uncommitted alongside these edits.
