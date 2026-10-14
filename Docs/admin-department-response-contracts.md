# ADMIN01 / DEPT01 response and error contracts

All paths below have the deployment prefix `/api/v1`. This batch preserves
existing permissions, workspace boundaries, lifecycle transitions and successful
HTTP status codes. It adds no grants, storage integration or migration.

## Operation results

| Operation                                  | Status                | Response                                                                  |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------------- |
| POST `/users`                              | 201                   | Existing allowlisted pending user; roles and legacy primary role          |
| POST `/users/:id/ban`                      | 201                   | Existing user result, BANNED; active tokens revoked                       |
| DELETE `/users/:id`                        | 200                   | Existing user result, DELETED; active tokens revoked                      |
| GET `/authorization/permissions`           | 200                   | Catalog metadata, including createdAt/updatedAt                           |
| GET/POST/PATCH roles; PUT role permissions | 200 / 201 / 200 / 200 | Role display metadata, permissions, userCount, timestamps; no workspaceId |
| DELETE `/authorization/roles/:id`          | 200                   | Role scalars including workspaceId/timestamps; no permissions/userCount   |
| PUT `/authorization/users/:userId/roles`   | 200                   | id and roles containing id/key/name                                       |
| GET departments/detail                     | 200                   | Department scalars, generated slug, status, boolean isDefault, timestamps |
| POST/PATCH department                      | 201 / 200             | Department scalars plus boolean homeCreated                               |
| POST department default/archive            | 201                   | Department scalars; no homeCreated                                        |

Dates serialize as ISO strings. Role description accepts null clearing; name
does not accept null. Unknown request fields remain rejected by the production
ValidationPipe. Permission, role, department and user outputs use explicit
projections/allowlists rather than exposing future database fields.

`homeCreated` records that the directory was absent at the initial check and
provisioning attempted creation. It does not assert exclusive creation,
ownership or continuing home health. False also covers an unchanged home.
Provisioning checks the existing absolute-path, allowed-root, real-directory,
access and provisioner configuration policies; no policy settings are changed.

Department lists remain ACTIVE-only. `includeArchived=true` is honored only
with `departments.manage`. Known archived IDs remain readable with
`departments.read` within the caller's workspace. Foreign IDs remain 404.

## Corrective errors

The standard Nest `{statusCode,error,message}` envelope is preserved. Expected
domain failures add `code`, `action`, and where relevant an input `field`.
ValidationPipe failures and authentication/authorization guard failures retain
their standard 400/401/403 envelopes; domain fields are optional in OpenAPI.
Database metadata, server paths, actor IDs and foreign identity details are
never included in the added context.

| Status/code                                                           | Corrective action                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 409 USER_PHONE_CONFLICT                                               | Choose another phone; uniqueness remains global, with the same error across workspaces                                                            |
| 409 ROLE_KEY_CONFLICT                                                 | Choose another key in the current workspace                                                                                                       |
| 400 ROLE_IDS_INVALID / PERMISSION_KEYS_UNKNOWN                        | Correct the requested IDs/keys; foreign and absent role IDs have the same response                                                                |
| 400 SELF_USER_PROTECTED / ROLE_SYSTEM_PROTECTED / SELF_ROLE_PROTECTED | Retain existing self/system safeguards                                                                                                            |
| 400 SELF_PERMISSION_GRANT_PROTECTED / SELF_MANAGEMENT_PROTECTED       | Retain current self grant and management restrictions                                                                                             |
| 409 ROLE_ASSIGNED / USER_OWNS_PROJECTS                                | Remove the existing assignment/ownership blocker through the existing workflow                                                                    |
| 409 DEPARTMENT_SLUG_CONFLICT                                          | Correct name; uniqueness is on its generated slug, not raw display text                                                                           |
| 409 DEPARTMENT_DEFAULT_CONFLICT                                       | Reread the current default before retrying                                                                                                        |
| 409 DEPARTMENT_HOME_IN_USE                                            | Retain the home after projects have been created                                                                                                  |
| 409 DEPARTMENT_ARCHIVED / DEPARTMENT_IS_DEFAULT                       | Respect existing archive/default rules                                                                                                            |
| 400 INPUT_INVALID / DEPARTMENT_NAME_INVALID / HOME_PATH_INVALID       | Correct the indicated input field                                                                                                                 |
| 503 HOME_CONFIGURATION_INVALID / HOME_PROVISIONING_FAILED             | Correct local configuration/access/provisioner failure before retrying; database mutation was not attempted, but directory side effects may exist |
| 404 RESOURCE_NOT_FOUND                                                | Resource absent/outside workspace, or deleted during the operation                                                                                |
| 409 CONSTRAINT_CONFLICT / STATE_CONFLICT                              | Reread before retrying; unrelated unique constraints are not mislabeled as duplicate phone/name/key                                               |
| 500 standard unexpected error                                         | Outcome may be unknown. Reread before retrying; never interpret as an empty read or proof that a mutation failed                                  |

Slug and partial default-index collisions are classified using Prisma constraint
targets (column arrays or index names). Known foreign-key changes and aborted
write conflicts are 409; unexpected errors continue to propagate as 500.
After a known rejected department write, only an empty newly provisioned home
is eligible for nonrecursive cleanup. Unknown write outcomes preserve that home
because a commit acknowledgement may have been lost. Filesystem provisioning
and database writes do not form an atomic transaction.

Real HTTP testing also found and fixed an existing admin creation defect:
Prisma inherits workspaceId in nested role assignment creation and rejects an
explicit redundant workspaceId there. The parent user still supplies the
workspace, composite user/role foreign keys enforce isolation, and assignedById
is retained. Tests assert the persisted workspace/role/audit actor.

## Scope and verification

ADMIN01 and DEPT01 are implemented for the supplied existing-contract scope.
Concurrent stale home/default/archive lifecycle redesign remains outside this
batch (DEPT03). There is no new permission policy. Profile bio/privacy remains
provisional and self-only; avatar/birthday/status/phone/username policy is not
expanded here. The parent owns Space checklist updates.

Latest user direction requires individual Everyone/Contacts/Custom list/No one
audiences for avatar, bio and status, and separate birthday day/month versus
year audiences. Everyone scope and contact acceptance rules are pending.
Future enforcement must redact for the server-side viewer across identity
projections and asset access. This batch makes no audience/contact assumptions
and leaves the provisional bio self-only.

Changed files for this batch:

- `src/accounts/accounts.controller.ts`, `src/accounts/accounts.service.ts`
- `src/authorization/authorization.controller.ts`, `authorization.dto.ts`, `authorization.service.ts`
- `src/departments/departments.controller.ts`, `departments.dto.ts`, `departments.service.ts`
- `src/openapi/api-docs.ts`, new `src/openapi/operation-errors.ts`
- `test/accounts.service.spec.ts`, `test/departments.update.spec.ts`
- New `test/admin-department.http.spec.ts`, `admin-department.openapi.spec.ts`, `admin-department.errors.spec.ts`
- This document and README reference

Tests include real Nest guards/services, real isolated PostgreSQL constraints,
real local directory provisioning, operation-specific OpenAPI schemas, and
fault-injected provisioning/constraint/race/unknown-outcome classification.
The test URL is opt-in and rejects any destination except
`127.0.0.1:55439/profile_test`; application DATABASE_URL is never a fallback.
No production database or security configuration was used or changed. The
existing additive self-profile migration is still required before this app;
this batch introduces no additional migration.

Final cumulative verification on 2026-10-11: **221 tests in 28 suites passed**
with the isolated database enabled, including all earlier profile/template/task/
project and authorization regressions. `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format` and `git diff --check` passed. A separate reviewer
checked the response/privacy/error changes and final cleanup/creation fixes;
no outstanding findings remain. The temporary PostgreSQL server was stopped
after verification; all implementation changes remain uncommitted locally.

Subsequent DEPT03 work supersedes the earlier directory cleanup behavior and
adds revision preconditions and atomic lifecycle/project guards. See
[mutation-concurrency-contracts.md](mutation-concurrency-contracts.md); failed
provisioned homes are now retained because exclusive ownership is unproven.
