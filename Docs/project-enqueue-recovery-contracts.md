# PROJECT03 initial-enqueue recovery

Scope clarification: this initial increment covered a known project ID. Its lost-ack test was the recover-enqueue operation, not original project creation. The later `Docs/project-creation-readback-contracts.md` adds client-keyed original creation and own-submission lookup; legacy missing keys cannot be reconstructed. Refer to that contract before claiming original-response recovery or legacy CLEAR compatibility.

Local uncommitted implementation, 12 October 2026. Existing project creation already atomically commits the project and first initialization job (earlier concurrency batch and trigger-injected rollback test). The remaining legacy gap is a persisted FAILED/INITIALIZING project with appliedTemplateVersionId but no initialization attempt. Ordinary retry rejects that case because it requires a latest FAILED/CANCELLED attempt. This increment recovers initial registration without turning it into an execution retry.

## Authorized endpoints

`GET /api/v1/projects/:projectId/initializations/recovery` returns:

```text
{projectId, projectStatus, pinnedTemplateVersionId: UUID|null,
 state: NO_ATTEMPT|ATTEMPT_EXISTS,
 canRegisterInitialSetup: boolean,
 blockedReason: null|ATTEMPT_EXISTS|NO_PINNED_TEMPLATE|
                PROJECT_NOT_RECOVERABLE|PINNED_TEMPLATE_UNAVAILABLE,
 latestAttempt: null|{id,templateVersionId,attempt,status}}
```

The snapshot uses repeatable read and deliberately exposes no logs, command output, paths, hashes, leases or unrelated project data. Management-only callers can read it without projects.initializations.read. Foreign/missing projects are 404; invalid UUID is 400; missing authentication or current scope is 401/403. Responses have Cache-Control:no-store.

`POST /api/v1/projects/:projectId/initializations/recover-enqueue` requires `{templateVersionId: UUIDv4}` matching the exact persisted pin. It returns HTTP 200:

```text
{registered:true, created:boolean, projectId, projectStatus,
 pinnedTemplateVersionId,
 initialization:{id,templateVersionId,attempt,status}}
```

Both endpoints require the freshly read OPEN account in the authenticated workspace, projects.initializations.manage, and existing initialization write scope: project membership, or projects.manage-all together with the existing project read scope (projects.read-all/readAccessEnabled). Merely enabling workspace read access does not authorize recovery. Guard-snapshot/stale actor grants are not trusted inside recovery. Member/lifecycle/grant policies are not otherwise expanded.

With no attempts, only FAILED/INITIALIZING projects are eligible, the department must be ACTIVE and the exact pin must resolve to a PUBLISHED version belonging to the same department/workspace. The latest published version is never substituted. A project without an applied pin has no setup to recover. A newly published version or archived template does not silently change the immutable pin; its original published version is used subject to the stated department/workspace checks.

Recovery holds the existing Workspace lock, then the scoped Project lock. It atomically creates QUEUED attempt 1, persists sequence-1 initialization.enqueue-recovered with actorId/projectId/templateVersionId/registrationOnly:true, and changes the project to INITIALIZING. Audit failure rolls all writes back. No filesystem provisioning, clearing or provider call happens in the endpoint. The ordinary worker can subsequently claim the queued job: registered/created never means setup succeeded or cannot execute. GET recovery/read initialization state remains authoritative for later status.

## Idempotence, errors and client reconciliation

The immutable recovery target is the resource pair (projectId, pinned templateVersionId), and the action is ensure first registration. No extra request ID or schema migration is necessary: the existing unique (projectId,attempt) constraint and locked history bind registration to attempt 1. Simultaneous calls return one initialization ID and exactly one created=true response. Repeated calls return the first attempt with created=false, including RUNNING/SUCCEEDED/FAILED/CANCELLED states and when later retry attempts exist. They never reset status, enqueue another attempt or retry commands. The recovery snapshot reports the latest attempt separately, so it can show a newer active retry.

409 PROJECT_TEMPLATE_CHANGED requires pinned-template readback. PROJECT_NOT_RECOVERABLE blocks DELETING or an ineligible no-attempt lifecycle. PINNED_TEMPLATE_UNAVAILABLE blocks unavailable department/version scope. INITIALIZATION_HISTORY_CONFLICT blocks an earliest attempt other than 1 or a first attempt bound to another version. Do not fill history holes or assume missing records prove external processes have stopped.

Unknown write acknowledgment or persistence error returns sanitized 503 PROJECT_ENQUEUE_OUTCOME_UNKNOWN with the caller's projectId/templateVersionId and reconciliation guidance. It does not mark the project FAILED or claim rollback. Read recovery state; if attempt 1 exists, retain its identity, otherwise repeat this same resource operation. A committed-but-unacknowledged registration cannot create a second job on repetition. Do not create a replacement project. Existing authorized project list/detail routes identify legacy persisted records and expose their ID/current setup state; after uncertain creation, locate the intended department/directory project rather than guessing a new name or automatically clearing a directory. These endpoints recover a known persisted ID; no arbitrary-directory lookup is introduced.

For a genuine FAILED/CANCELLED attempt, use the existing explicit POST initializations/retry after deliberate inspection. Its pre-existing execution/lease/cancellation semantics and generic retry contract are not upgraded or presented as universally idempotent by this increment. STOP_UNCONFIRMED acknowledgment, process containment and worker restart/fencing remain separate decisions/work. Recovery assumes supported repository writers retain initialization history; raw deletion/corruption is not evidence to replay work.

## Existing data and verification boundaries

Recovery never clears existing data or invokes KEEP/CLEAR. The existing worker rejects a nonempty final project directory before commands; the isolated regression verifies existing file content remains intact. General external-writer races, staging/process termination and multi-instance initialization-worker behavior remain outside PROJECT03. No live initialization command, storage integration, production migration or deployment was exercised.

Real isolated PostgreSQL/HTTP tests cover legacy missing attempt, exact original pin despite newer publication, concurrent one-registration outcome, retry-after-failure identity, committed lost acknowledgment, transactional audit failure, current grants/membership/workspace, manage-only readback, public read access not granting recovery, unavailable template/department and foreign pin, lifecycle denial, existing nonempty data, OpenAPI/UUID validation, later work, corrupt history and completed/cancelled/running identity retention. The worker is disabled in fixtures. Independent review found no actionable blocker; suggested edge cases were added.

Verification: 17 new recovery HTTP/PostgreSQL cases; cumulative 455 tests / 42 suites passed. Typecheck, ESLint, Prettier, Nest build and git diff --check passed. Initial fixture/type errors were corrected before the green runs. No tests remain failing. No live worker command, provider/storage integration or production deployment was tested. Isolated localhost:55439/profile_test stopped at handoff. No PROJECT03 schema/migration change was needed; the preceding SESSION04/06 additive migration had already passed isolated schema agreement checks.

Exact PROJECT03 changed files: src/projects/project-enqueue-recovery.dto.ts; src/projects/project-initialization.service.ts; src/projects/project-initializations.controller.ts; test/project-enqueue-recovery.http.spec.ts; Docs/project-enqueue-recovery-contracts.md; README.md. No schema/migration change for this batch. All SESSION04/06 and earlier work remains preserved. Parent owns Space checklist updates.
