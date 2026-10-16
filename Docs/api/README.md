# ProboxAI API documentation handoff

Backend checkpoint: v0.3.0-dev.9, commit fde9cc268b0a49274eb196ddb3b7f3b5e9900137.
The export contains 160 unique operations from 24 registered controllers.
Source-derived contracts and backend regressions prove local implementation; they
do not prove deployment, frontend wiring or per-endpoint live execution. No
application services or ProboxAI requests were started by the export/sync work.

## Postman delivery status: blocked

Verified destination: [ProboxAI Managements](https://go.postman.co/workspace/d69d0c23-a314-4ec5-95fc-3146146fa2f7),
visibility personal, team null. Ten existing collections contain 81 saved requests
covering 80 unique operations; the Telegram scenario variants are intentional.
The prepared plan preserves every existing request ID, scenario, body, script,
example and auth configuration, adds 80 missing operations in the same collections,
updates contract descriptions and missing required headers, and removes only a
proven empty malformed Users variable. Environment values were never fetched.

Automatic approval review rejected the first collection replacement because it
could not verify trusted authorization for the exact private workspace mutation
and disclosure of internal contract details. No write succeeded; the first
collection was read back unchanged. No alternative write method was attempted.
The resting owner was not asked a question. External synchronization remains
blocked pending resolution of that authorization review; do not report Postman
completion from these local artifacts. No public publishing or visibility change.

## Deliverables

- [OpenAPI](openapi.json): source-derived schemas, security, parameters, responses
  and exact route permission metadata. Postman syntax lint: zero violations.
- [Endpoint inventory](endpoints.json): all registered operations.
- [Documentation templates](postman-operation-docs.json): credential placeholders,
  required starter bodies, optional upload fields disabled, complete transitively
  referenced definitions and source-specific error/retry guidance. They are
  templates, not captured successful responses; select conditional inputs and
  fill verified IDs/revisions before any deliberate execution.
- [Pending synchronization plan](postman-sync-plan.json): existing collection UIDs,
  request identities and exact additions. It contains no environment values or
  copied credentials. Re-read collections before any later authorized write.
- [Gap/decision review](../backend-overnight-gap-review.md): source-grounded
  remaining policy choices; no shared checklist was changed.
- [UI handoff](../backend-ui-handoff.md): Done stages, one main Save commits,
  pre-submit Cancel discards. Backend completion is separate from UI wiring.

Regenerate with pnpm build, node scripts/export-api-contract.mjs Docs/api, and
node scripts/build-postman-docs.mjs. Validate with node scripts/verify-api-docs.mjs
and postman spec lint Docs/api/openapi.json --issueType syntax --no-report-events.
The installed Postman CLI 1.74.0 lacked workspace access; the connected Postman
tool could read the private workspace. No credential was requested or written.

## Registered local operations

| Method | Path                                                                            | Contract                                                                                   |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/users/me`                                                              | Read your own profile                                                                      |
| PATCH  | `/api/v1/users/me`                                                              | Update your own names, bio and birth date                                                  |
| GET    | `/api/v1/users/me/telegram-link`                                                | Read your stored Telegram link status                                                      |
| GET    | `/api/v1/users`                                                                 | List workspace users                                                                       |
| POST   | `/api/v1/users`                                                                 | Create a pending workspace user                                                            |
| POST   | `/api/v1/users/{id}/ban`                                                        | Ban a workspace user                                                                       |
| DELETE | `/api/v1/users/{id}`                                                            | Delete a workspace user                                                                    |
| POST   | `/api/v1/telegram/webhook`                                                      | Receive Telegram contact, task and inline-keyboard updates                                 |
| GET    | `/api/v1/users/me/status`                                                       | Read your shared manual availability                                                       |
| PUT    | `/api/v1/users/me/status`                                                       | Set or clear your shared manual availability                                               |
| GET    | `/api/v1/users/me/status/operations/{requestId}`                                | Reconcile your own status change                                                           |
| GET    | `/api/v1/profiles/{accountId}/status`                                           | Read one shared manual availability                                                        |
| GET    | `/api/v1/users/me/audience-picker`                                              | Search mixed public accounts and your authorized workspace, or expand its account children |
| GET    | `/api/v1/users/me/contacts/{accountId}/alias`                                   | ProfilePicker_alias                                                                        |
| PUT    | `/api/v1/users/me/contacts/{accountId}/alias`                                   | Set or clear your private contact alias                                                    |
| DELETE | `/api/v1/users/me/contacts/{accountId}/alias`                                   | ProfilePicker_clearAlias                                                                   |
| PUT    | `/api/v1/users/me/profile`                                                      | Save staged profile fields and audiences atomically                                        |
| GET    | `/api/v1/users/me/privacy`                                                      | Read your field audiences                                                                  |
| PUT    | `/api/v1/users/me/privacy/{field}`                                              | Atomically replace your field audience                                                     |
| GET    | `/api/v1/users/me/contacts`                                                     | Read your directed Contacts entries                                                        |
| PUT    | `/api/v1/users/me/contacts/{accountId}`                                         | Add a known account to your Contacts                                                       |
| DELETE | `/api/v1/users/me/contacts/{accountId}`                                         | Remove a known account from your Contacts                                                  |
| GET    | `/api/v1/users/me/profile/edit`                                                 | Read one coherent self profile edit baseline                                               |
| PUT    | `/api/v1/users/me/profile/changes`                                              | Commit the complete staged Profile Save atomically                                         |
| GET    | `/api/v1/users/me/profile/operations/{requestId}`                               | Reconcile your whole Profile Save                                                          |
| GET    | `/api/v1/profiles/by-username/{username}`                                       | Look up public identity and viewer-visible profile fields by username                      |
| GET    | `/api/v1/profiles/{accountId}`                                                  | Read public identity with server-evaluated biography and independent birthday parts        |
| POST   | `/api/v1/auth/registration/otp/send`                                            | Send a registration OTP through Telegram                                                   |
| POST   | `/api/v1/auth/registration/otp/verify`                                          | Verify a registration OTP                                                                  |
| GET    | `/api/v1/auth/usernames/availability`                                           | Check username availability                                                                |
| POST   | `/api/v1/auth/registration`                                                     | Complete platform registration                                                             |
| POST   | `/api/v1/auth/login`                                                            | Sign in with username and password                                                         |
| POST   | `/api/v1/auth/refresh`                                                          | Refresh an access token                                                                    |
| POST   | `/api/v1/auth/password-reset/otp/send`                                          | Send a password-reset OTP through Telegram                                                 |
| POST   | `/api/v1/auth/password-reset/otp/verify`                                        | Verify a password-reset OTP                                                                |
| POST   | `/api/v1/auth/password-reset`                                                   | Set a new password                                                                         |
| GET    | `/api/v1/authorization/me`                                                      | Get the caller's current effective authorization                                           |
| GET    | `/api/v1/authorization/revision`                                                | Authorization_revision                                                                     |
| GET    | `/api/v1/authorization/roles/{id}/edit`                                         | Read a role permission edit snapshot with workspace authorization revision                 |
| GET    | `/api/v1/authorization/users/{userId}/roles`                                    | Read user role assignments with workspace authorization revision                           |
| PUT    | `/api/v1/authorization/users/{userId}/roles`                                    | Replace a user's role assignments                                                          |
| GET    | `/api/v1/authorization/permissions`                                             | List the assignable permission catalog                                                     |
| GET    | `/api/v1/authorization/roles`                                                   | List workspace roles with permissions                                                      |
| POST   | `/api/v1/authorization/roles`                                                   | Create a custom workspace role                                                             |
| PATCH  | `/api/v1/authorization/roles/{id}`                                              | Update role display metadata                                                               |
| DELETE | `/api/v1/authorization/roles/{id}`                                              | Delete an unassigned custom role                                                           |
| PUT    | `/api/v1/authorization/roles/{id}/permissions`                                  | Replace a role's permission set                                                            |
| GET    | `/api/v1/configuration-templates/versions/{versionId}/revision`                 | Read a workspace-scoped mutation revision without a read grant                             |
| GET    | `/api/v1/configuration-templates`                                               | List configuration templates                                                               |
| POST   | `/api/v1/configuration-templates`                                               | Create a template with draft version 1                                                     |
| GET    | `/api/v1/configuration-templates/upload-configuration`                          | Read effective template upload limits                                                      |
| GET    | `/api/v1/configuration-templates/{id}`                                          | Get a template and its visible versions                                                    |
| PATCH  | `/api/v1/configuration-templates/{id}`                                          | Update template metadata                                                                   |
| POST   | `/api/v1/configuration-templates/{id}/drafts`                                   | Clone the latest published version into a new draft                                        |
| POST   | `/api/v1/configuration-templates/{id}/archive`                                  | Archive a configuration template                                                           |
| PUT    | `/api/v1/configuration-templates/versions/{versionId}/manifest`                 | Atomically replace draft folders and ordered command stages                                |
| POST   | `/api/v1/configuration-templates/versions/{versionId}/files`                    | Upload and register an immutable MinIO-backed file                                         |
| PATCH  | `/api/v1/configuration-templates/versions/{versionId}/files/{fileId}`           | Change a draft file destination path                                                       |
| DELETE | `/api/v1/configuration-templates/versions/{versionId}/files/{fileId}`           | Remove a file registration from a draft                                                    |
| POST   | `/api/v1/configuration-templates/versions/{versionId}/publish`                  | Validate and immutably publish a draft version                                             |
| GET    | `/api/v1/departments/{id}/revision`                                             | Read a workspace-scoped mutation revision without a read grant                             |
| GET    | `/api/v1/departments`                                                           | List active workspace departments                                                          |
| POST   | `/api/v1/departments`                                                           | Create a department and provision its home directory                                       |
| GET    | `/api/v1/departments/{id}`                                                      | Get an active or archived department in the caller workspace                               |
| PATCH  | `/api/v1/departments/{id}`                                                      | Update an unused department home or its name                                               |
| POST   | `/api/v1/departments/{id}/default`                                              | Make a department the workspace default                                                    |
| POST   | `/api/v1/departments/{id}/archive`                                              | Archive a non-default department                                                           |
| POST   | `/api/v1/chat-groups`                                                           | Create group metadata                                                                      |
| GET    | `/api/v1/chat-groups/creations/{requestId}`                                     | Read your group creation outcome                                                           |
| GET    | `/api/v1/chat-groups/{groupId}`                                                 | Read your created group metadata                                                           |
| GET    | `/api/v1/health`                                                                | Check API health                                                                           |
| GET    | `/api/v1/health/ready`                                                          | Check PostgreSQL and MinIO readiness                                                       |
| POST   | `/api/v1/projects/{projectId}/archive`                                          | Archive an owned project without removing its context                                      |
| GET    | `/api/v1/projects/{projectId}/initializations/recovery`                         | Read initial-enqueue recovery state                                                        |
| POST   | `/api/v1/projects/{projectId}/initializations/recover-enqueue`                  | Ensure the project's first pinned setup attempt is registered                              |
| GET    | `/api/v1/projects/{projectId}/initializations`                                  | List project initialization attempts                                                       |
| GET    | `/api/v1/projects/{projectId}/initializations/{initializationId}`               | Get initialization status and bounded step logs                                            |
| GET    | `/api/v1/projects/{projectId}/initializations/{initializationId}/events`        | Replay bounded persisted initialization events                                             |
| GET    | `/api/v1/projects/{projectId}/initializations/{initializationId}/events/stream` | Replay and stream initialization events                                                    |
| POST   | `/api/v1/projects/{projectId}/initializations/{initializationId}/cancel`        | Cancel a queued or running initialization                                                  |
| POST   | `/api/v1/projects/{projectId}/initializations/retry`                            | Retry the latest failed initialization from clean staging                                  |
| GET    | `/api/v1/projects/{projectId}/member-candidates`                                | Discover eligible project member candidates                                                |
| POST   | `/api/v1/projects/creation-submissions`                                         | Submit identifiable project creation without replaying filesystem work                     |
| GET    | `/api/v1/projects/creation-submissions/{requestId}`                             | Read the caller's own creation outcome without project-list access                         |
| GET    | `/api/v1/projects`                                                              | List accessible projects                                                                   |
| POST   | `/api/v1/projects`                                                              | Create a project                                                                           |
| GET    | `/api/v1/projects/{id}`                                                         | Get project details                                                                        |
| PUT    | `/api/v1/projects/{id}`                                                         | Update project settings                                                                    |
| POST   | `/api/v1/projects/{id}/members`                                                 | Add a project member                                                                       |
| DELETE | `/api/v1/projects/{id}/members/{userId}`                                        | Remove a project member                                                                    |
| POST   | `/api/v1/projects/{id}/folders`                                                 | Create a project folder                                                                    |
| GET    | `/api/v1/projects/{id}/files`                                                   | List a project directory                                                                   |
| GET    | `/api/v1/projects/{id}/files/upload-configuration`                              | Read effective project upload configuration                                                |
| POST   | `/api/v1/projects/{id}/files/upload`                                            | Upload a project file                                                                      |
| POST   | `/api/v1/projects/{id}/files/move`                                              | Move or rename a project file or folder                                                    |
| GET    | `/api/v1/projects/{id}/protected-file-types`                                    | List protected file extensions                                                             |
| POST   | `/api/v1/projects/{id}/protected-file-types`                                    | Append a protected file extension                                                          |
| PUT    | `/api/v1/projects/{id}/protected-file-types/{typeId}`                           | Update a protected file extension (owner only)                                             |
| DELETE | `/api/v1/projects/{id}/protected-file-types/{typeId}`                           | Remove a protected file extension (owner only)                                             |
| POST   | `/api/v1/projects/{id}/files/delete`                                            | Move a file or folder to the recoverable project trash                                     |
| POST   | `/api/v1/projects/{id}/files/delete-confirmations/{confirmationId}/confirm`     | Confirm deletion of a protected project file or folder                                     |
| GET    | `/api/v1/projects/{id}/file-operations`                                         | Projects_fileOperations                                                                    |
| GET    | `/api/v1/projects/{id}/file-operations/{operationId}`                           | Projects_fileOperation                                                                     |
| POST   | `/api/v1/projects/{id}/file-operations/{operationId}/reconcile`                 | Inspect a deletion outcome and repair its database state without moving bytes              |
| GET    | `/api/v1/projects/{id}/trash`                                                   | List recoverable project trash items                                                       |
| POST   | `/api/v1/projects/{id}/trash/{trashId}/restore`                                 | Restore a recoverable project trash item                                                   |
| GET    | `/api/v1/projects/{id}/deletion-requests`                                       | Read recent deletion state                                                                 |
| POST   | `/api/v1/projects/{id}/deletion-requests`                                       | Request permanent project deletion                                                         |
| GET    | `/api/v1/projects/{id}/deletion-requests/{requestId}`                           | Reconcile a known deletion request                                                         |
| POST   | `/api/v1/projects/{id}/deletion-requests/{requestId}/approve`                   | Owner approval and deletion-token preflight                                                |
| POST   | `/api/v1/projects/{id}/deletion-requests/{requestId}/active-sessions`           | Owner chooses whether live project sessions should wait or be interrupted                  |
| POST   | `/api/v1/projects/{id}/deletion-requests/{requestId}/cancel`                    | Cancel an outstanding project deletion request                                             |
| POST   | `/api/v1/projects/{id}/deletion-requests/{requestId}/confirm`                   | Submit the owner Telegram token and permanently delete the project                         |
| GET    | `/api/v1/projects/{id}/files/download`                                          | Download a project file                                                                    |
| GET    | `/api/v1/settings/projects-home`                                                | Get the legacy default projects home                                                       |
| PUT    | `/api/v1/settings/projects-home`                                                | Set the legacy default projects home                                                       |
| GET    | `/api/v1/sessions`                                                              | List sessions for your assigned tasks                                                      |
| POST   | `/api/v1/sessions`                                                              | Start a managed coding session                                                             |
| POST   | `/api/v1/sessions/directory-preflight`                                          | Validate an authorized session directory without creating a session                        |
| GET    | `/api/v1/sessions/projects/{projectId}/execution-context`                       | Resolve an authorized selected project for session setup                                   |
| GET    | `/api/v1/sessions/model-catalog`                                                | List managed session models and thinking efforts                                           |
| GET    | `/api/v1/sessions/{id}`                                                         | Get a session and its turns                                                                |
| POST   | `/api/v1/sessions/{id}/turns`                                                   | Start a follow-up turn                                                                     |
| GET    | `/api/v1/sessions/{id}/turns/by-request/{requestId}`                            | Reconcile a known follow-up submission                                                     |
| POST   | `/api/v1/sessions/{id}/interrupt`                                               | Interrupt the active local runner                                                          |
| GET    | `/api/v1/sessions/{id}/events`                                                  | Read bounded persisted session history                                                     |
| GET    | `/api/v1/sessions/{id}/events/stream`                                           | Replay and stream committed session events                                                 |
| POST   | `/api/v1/projects/{projectId}/tasks/{taskId}/link`                              | Explicitly link an owned task to one project board                                         |
| PATCH  | `/api/v1/projects/{projectId}/tasks/{taskId}/details`                           | Edit an owned task's title, description or human priority                                  |
| PUT    | `/api/v1/projects/{projectId}/tasks/{taskId}/assignees`                         | Replace an owned task's human assignee set                                                 |
| PUT    | `/api/v1/projects/{projectId}/tasks/{taskId}/workflow-status`                   | Move an assigned task between its project workflow columns                                 |
| POST   | `/api/v1/projects/{projectId}/tasks/{taskId}/checklist`                         | Append a single-assignee checklist item to an owned task                                   |
| PATCH  | `/api/v1/projects/{projectId}/tasks/{taskId}/checklist/{itemId}`                | Edit an owned task's checklist definition                                                  |
| DELETE | `/api/v1/projects/{projectId}/tasks/{taskId}/checklist/{itemId}`                | Remove a checklist definition from an owned task                                           |
| PUT    | `/api/v1/projects/{projectId}/tasks/{taskId}/checklist/{itemId}/completion`     | Check or uncheck only the caller's assigned checklist item                                 |
| PUT    | `/api/v1/projects/{projectId}/tasks/{taskId}/checklist/order`                   | Reorder every checklist item of an owned task                                              |
| POST   | `/api/v1/projects/{projectId}/tasks/{taskId}/comments`                          | Append a plain human comment to an assigned task                                           |
| GET    | `/api/v1/projects/{projectId}/tasks/{taskId}/comments`                          | Read bounded comments as a current project member                                          |
| GET    | `/api/v1/projects/{projectId}/tasks/{taskId}/audit`                             | Read bounded human task history as a current project member                                |
| GET    | `/api/v1/projects/{projectId}/tasks/{taskId}/operations/{requestId}`            | Read a saved human action outcome without repeating it                                     |
| GET    | `/api/v1/projects/{projectId}/tasks`                                            | Read deliberately linked human tasks as a current project member                           |
| GET    | `/api/v1/projects/{projectId}/tasks/query`                                      | Query bounded human tasks with scoped summaries                                            |
| GET    | `/api/v1/projects/{projectId}/tasks/{taskId}`                                   | Read one human task within current project membership                                      |
| GET    | `/api/v1/projects/{projectId}/task-board`                                       | Read workflow metadata for a readable project                                              |
| GET    | `/api/v1/projects/{projectId}/task-board/edit`                                  | Read the status-management snapshot                                                        |
| POST   | `/api/v1/projects/{projectId}/task-board/statuses`                              | Create a workflow status                                                                   |
| PATCH  | `/api/v1/projects/{projectId}/task-board/statuses/{statusId}`                   | Rename or recolor a stable workflow status                                                 |
| DELETE | `/api/v1/projects/{projectId}/task-board/statuses/{statusId}`                   | Move referenced tasks atomically and remove a status                                       |
| PUT    | `/api/v1/projects/{projectId}/task-board/statuses/order`                        | Replace the complete ordered status list                                                   |
| GET    | `/api/v1/projects/{projectId}/task-board/operations/{requestId}`                | Reconcile a workflow mutation by stable request identity                                   |
| GET    | `/api/v1/projects/{projectId}/task-board/audit`                                 | Read bounded workflow configuration history                                                |
| GET    | `/api/v1/tasks/{taskId}/deadline`                                               | Read a task deadline                                                                       |
| PUT    | `/api/v1/tasks/{taskId}/deadline`                                               | Set or clear a task deadline atomically                                                    |
| GET    | `/api/v1/tasks/{taskId}/deadline/edit`                                          | Read an authorized task deadline edit snapshot                                             |
| GET    | `/api/v1/tasks/{taskId}/deadline/operations/{requestId}`                        | Reconcile a deadline change without replay                                                 |
| GET    | `/api/v1/tasks/{taskId}/deadline/audit`                                         | Read bounded deadline history in current deadline edit scope                               |
| POST   | `/api/v1/tasks`                                                                 | Create a task                                                                              |
| GET    | `/api/v1/tasks`                                                                 | List visible tasks                                                                         |
| GET    | `/api/v1/tasks/creations/{requestId}`                                           | Read your frozen task creation outcome by request ID                                       |
| GET    | `/api/v1/tasks/{id}`                                                            | Read a visible task by stable identity                                                     |

## Exact changed-file manifests

Atomic Profile Save checkpoint (22 files, fde9cc2):

- CHANGELOG.md
- Docs/atomic-profile-save-contracts.md
- Docs/backend-feature-availability.md
- Docs/backend-release-catalog.json
- Docs/backend-ui-handoff.md
- Docs/profile-privacy-foundations.md
- Docs/shared-manual-status-contracts.md
- package.json
- prisma/migrations/20261016020000_atomic_profile_save/migration.sql
- prisma/schema.prisma
- scripts/verify-profile-save-migration.mjs
- src/accounts/accounts.module.ts
- src/accounts/accounts.service.ts
- src/accounts/manual-status.service.ts
- src/accounts/profile-privacy.service.ts
- src/accounts/profile-save.controller.ts
- src/accounts/profile-save.dto.ts
- src/accounts/profile-save.service.ts
- test/manual-status.http.spec.ts
- test/profile-save.http.spec.ts
- test/self-profile.persistence.spec.ts
- test/self-profile.spec.ts

Documentation checkpoint (14 files; current local commit/tag recorded in Git):

- CHANGELOG.md
- Docs/api/README.md
- Docs/api/endpoints.json
- Docs/api/openapi.json
- Docs/api/postman-operation-docs.json
- Docs/api/postman-sync-plan.json
- Docs/backend-feature-availability.md
- Docs/backend-overnight-gap-review.md
- Docs/backend-release-catalog.json
- Docs/backend-ui-handoff.md
- package.json
- scripts/build-postman-docs.mjs
- scripts/export-api-contract.mjs
- scripts/verify-api-docs.mjs

The pre-existing root README.md change and untracked linked-agent assessment are
excluded from both checkpoints and preserved byte-for-byte.
