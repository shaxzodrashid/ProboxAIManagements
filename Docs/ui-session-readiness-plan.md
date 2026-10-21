# Fastest complete UI-to-session path

18 October 2026. Current `dev` checkout, base
`13f4b6f18a6a2bb310ec79f41d99ce4a12e0db90`, preserved uncommitted patch.
This is an implementation plan grounded in source/contracts and existing local
tests. It does not claim a browser flow, deployed service or live AI run was tested.
A separate read-only collaborator traced the complete flow and reviewed the bot
changes; no collaborator edited files or executed a provider.

## First usable path and exit condition

Build in this order: **existing OPEN account → its current workspace → existing
READY project → task managed by that employee → session setup/preflight → one
session request → persisted assistant output → committed run completion**.
Then add recoverable empty-project/task creation and follow-up/interrupt/reconnect
acceptance gates. Keep the same branch and current backend contracts.

The first exit condition is a real browser completing that whole chain against
a controlled runner, followed by the same chain through the intended browser
proxy. A separately authorized harmless live-provider smoke is the later runtime
gate. Backend routes alone do not satisfy either browser or live-provider gate.

The existing frontend is verified at
`D:\Shakhzod\Javascript\ProboxAI_Frontend`, registered as **ProBoxAI Frontend**.
It contains a React Router SPA and implemented sign-in, activation/recovery forms,
en/ru/uz catalogs and auth model/adapter/browser tests. It was inspected read-only;
no frontend file, branch, build, fixture or dependency was changed.

**Login UI exists; live login remains deliberately gated.** Production
`src/app/routes/auth.tsx` exports Authentication, whose default is
`unavailableAuthApi`; the HTTP adapter's `signIn` also rejects as unavailable.
ADR-003 and the later authentication UI feedback explicitly retain the user's
cookie/BFF gate. Only auth routes and the sign-in fallback are registered; there
is no authenticated workspace/project/task/session destination yet. The real
activation/recovery HTTP adapter is connected only to an isolated simulation
harness, not a live API origin. Frontend location is no longer a user blocker.

The first dependency is the approved browser-session and target-origin contract.
Reuse the existing forms, navigation, locale/error/concurrency handling and tests.
Do not invent a replacement frontend, token persistence policy, cookie endpoints
or a `VITE_API_URL`: public config currently permits environment/release keys only.

All paths below are relative to `/api/v1`.

The existing-project/task UI path needs current `projects.read`, `tasks.read`,
`sessions.create` and `sessions.read`, plus actual project membership and task
execution-manager ownership. Follow-up/stop additionally need `sessions.manage`.
Creation branches add their specific create permissions below. This is an
integration prerequisite inventory, not authorization to grant or change roles.
Telegram retains its own existing permission checks; it is not a way around REST
scope. Do not send an invented requestId field to initial session creation.

## Complete contract chain

| Stage                 | Existing contract / prerequisites                                                                                                                                                                                                          | Required UI state and acceptance                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in               | `POST /auth/login`; existing OPEN username/password account. Returns access/refresh pair. `POST /auth/refresh` returns a new access token only; refresh token is not rotated.                                                              | Invalid credentials, unavailable service and signed-in states are distinct. Preserve draft across access expiry; avoid refresh loops. Existing auth service/guard/availability tests support local behavior. Registration, if needed, also requires precreated account admission and verified Telegram contact/OTP; no credentials or accounts are provisioned in this plan.                                                  |
| Current workspace     | `GET /users/me` and `GET /authorization/me` derive persisted identity/workspace/current grants. No workspace list/switch/create API exists.                                                                                                | Display the account's current workspace context. Zero-grant accounts receive useful unavailable/empty states. Do not infer workspace access from a cached role label or invent a workspace selector.                                                                                                                                                                                                                          |
| Choose project        | `GET /projects`, `GET /projects/:id`; `projects.read` plus current visibility/scope. Execution separately requires actual membership or `projects.manage-all`, READY/nonarchived project, ACTIVE department and valid canonical directory. | A readable/public project may be unrunnable. Show read versus execution availability separately and retain selection when preflight fails. Public nonmember and foreign-workspace tests must deny launch.                                                                                                                                                                                                                     |
| Choose execution task | `GET /tasks`, `GET /tasks/:id`; `tasks.read`, manager-scoped unless read-all. Start still requires `task.managerId === caller.id`.                                                                                                         | Use an employee-managed execution task. Human-board assignee, creator, project owner and administrator labels do not substitute for execution manager. A task visible through read-all can still be unrunnable.                                                                                                                                                                                                               |
| Configure run         | `GET /sessions/model-catalog[?providerId=...]`; `sessions.create`. Catalog supplies provider/model/default effort and supported efforts, not live availability.                                                                            | Offer only the selected model's returned efforts. Retain selection across errors and display missing runtime availability honestly. Use an existing allowed sandbox; the first non-writing smoke can use read-only. No new provider integration or security setting is selected.                                                                                                                                              |
| Resolve directory     | `GET /sessions/projects/:projectId/execution-context?taskId=...&sandbox=...`; `POST /sessions/directory-preflight` with taskId, selected projectId, sandbox and optional cwd. Both revalidate current scope.                               | Use returned canonical selected-project context and reason-specific invalid state. Omit cwd on create to use the project directory, or pass the deliberately preflighted path. Preflight is advisory; grants/paths are checked again at launch. No extra filesystem browser or directory provisioning is implied.                                                                                                             |
| Start                 | `POST /sessions`: taskId, prompt, sandbox, selected projectId and selected provider/model/effort; optional cwd. Requires `sessions.create`, current assigned manager and current execution scope.201 includes initialTurn.                 | Disable duplicate submission and persist returned session/turn IDs before navigation. Show accepted/queued independently from running/completed. **Initial create has no client requestId or original-request readback. A timeout must show unknown outcome and must not automatically resubmit.**                                                                                                                            |
| Read/live output      | `GET /sessions/:id`, `/events`, `/events/stream`; `sessions.read` and current manager scope. Persisted sequence/history bounds; SSE supports after/Last-Event-ID and reauthorization.                                                      | Use bearer-authenticated streaming fetch or the frontend's equivalent; native EventSource cannot attach this Authorization header. Apply each sequence once, reconnect from last applied sequence, and reconcile via REST after transport loss or expiry. Render committed assistant snapshots and explicit omissions. No token-delta typing, raw terminal output, historical diff or interactive approval UI is established. |
| Follow-up             | `POST /sessions/:id/turns` with prompt and retained UUID requestId; `sessions.manage`;202. Read `GET /sessions/:id/turns/by-request/:requestId` for reconciliation. Manage-only receipt access is supported.                               | Preserve exact requestId/prompt after unknown outcome; reconcile or replay unchanged. Changed reuse and active-turn conflict remain409. Never silently rebase a prompt or create another session as recovery.                                                                                                                                                                                                                 |
| Stop and recovery     | `POST /sessions/:id/interrupt` with observed turnId; `sessions.manage`. Targeted durable intent, not proof of process exit. Detail includes stopConfirmation/recoveryReason.                                                               | Show Stop requested until persisted state settles. Reject stale turn targets. STOP_UNCONFIRMED blocks follow-up/resume; no override or automatic replay is selected. Even LOCAL_EXIT_OBSERVED does not prove all descendants stopped or files are safe.                                                                                                                                                                       |
| Completion            | Committed `session.state` plus REST state is authoritative; provider `turn.completed` alone is insufficient.                                                                                                                               | Render COMPLETED/FAILED/INTERRUPTED from persisted server state, keep outcome unknown distinct, and drain/reconcile final events. AI run completion does not confirm the human task; creator-only manual confirmation is separate.                                                                                                                                                                                            |

## Creation and direct-path alternatives

| Branch                             | Existing contract                                                                                                                                                                                                                                                    | Minimum integration and boundary                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create project                     | Prefer `POST /projects/creation-submissions` with retained requestId and `GET /projects/creation-submissions/:requestId`; `projects.create`. Active default department/home and permitted server paths are prerequisites.                                            | Recommend an empty project after the existing-project path works. Omit template; wait for authoritative READY. Keep the same key after uncertainty. An existing-directory KEEP/CLEAR decision must remain explicit; never default to CLEAR. Template creation additionally needs a published version, template storage and successful initialization/history. |
| Create task                        | `POST /tasks` with requestId; `tasks.create`; caller becomes creator and execution manager. `GET /tasks/creations/:requestId` reconciles.                                                                                                                            | Always retain a UUID in the UI. Exact identical retry is supported; task creation starts no session and creates no human-board association.                                                                                                                                                                                                                   |
| Show created task on project board | `GET /projects/:projectId/task-board`; `tasks.boards.read` and `projects.read`. Explicit `POST /projects/:projectId/tasks/:taskId/link` with requestId, quoted current initial revision0, and same-board statusId; `tasks.create`, creator ownership and membership. | Human project task/query endpoints intentionally omit AI execution fields. Link only if board visibility is part of the chosen screen. The selected execution project and the human task's board association are separate facts. Reconcile the link's operation receipt; do not treat creation as automatic linkage.                                          |
| Direct/manual-directory session    | Omit projectId and supply allowed absolute cwd, while still supplying required taskId and using its assigned manager.                                                                                                                                                | Task-free sessions do not exist. Recommend preserving the current task requirement for the first slice. Offer a manual path only once the existing allowed-root/preflight UI is wired; no arbitrary server filesystem access.                                                                                                                                 |

## Blocking dependencies and recommended sequence

1. **Resolve the existing browser-session gate, then reuse login.** Frontend location
   and implemented forms are verified. Recommend preserving the user's cookie/BFF
   direction: approve the same-origin browser/API topology, cookie/CSRF controls,
   refresh/expiry/reload, logout/revocation scope and account-change behavior before
   live wiring. Backend bearer login does not itself implement that browser contract.
   Next wire the real sign-in adapter, session bootstrap and protected destination,
   self/grants/current workspace and project/task reads. Acceptance: the existing
   browser form reaches an authenticated selection screen against a controlled
   local backend, with clear401/503/expired/denied states and no AI execution.
2. **Verify browser connectivity.** `src/main.ts` binds127.0.0.1 and does not enable
   CORS. Recommend the existing deployment's same-origin `/api/v1` proxy for the
   minimum slice; verify SSE buffering/timeouts and Authorization forwarding.
   A separate origin requires an explicit origin configuration decision; no CORS
   or live security settings are changed here.
3. **Wire setup/start with a controlled runner.** Read catalog/context, preflight,
   submit once and persist IDs, then render REST/SSE snapshots and server completion.
   Keep initial-start unknown outcome visible and never automatically retry it.
4. **Add creation plus recovery acceptance.** Empty project receipt, task receipt,
   optional explicit board link, task ownership check, then the same run path.
   These paths already have backend recovery contracts; they need browser wiring.
5. **Verify the existing runtime before a live run.** An operator must verify
   `PROBOXAI_BIN` → wrapper → configured Codex executable, JSONL compatibility,
   existing authorized provider configuration/entitlement, allowed cwd permissions
   and writable archive location. `safeEnvironment()` forwards a selected set of
   runner/provider settings; arbitrary process credentials are not guaranteed to
   reach the child. No values are read out, credentials created or paid run made.
   Catalog support and `/health/ready` do not prove this: health-ready checks
   PostgreSQL/template storage, not runner/provider/feature readiness.
6. **Separately authorize and record one harmless live-provider smoke.** Validate
   the whole login-to-result chain through the intended UI/proxy, recording target
   backend version/commit and observed provider/model/protocol outcome. Until this
   happens, label execution **implemented/local-tested; deployed/provider unverified**.

Avatar provisioning, mirror visibility/edit/deletion policy, reopening and blocked
Postman synchronization are independent of this minimum path. Initial UI identity
can use text/initials. No discussion model, public task mirror or new permission
grant is needed to demonstrate the authorized existing session flow.

## Essential choices explained plainly

- **One workspace now:** use the employee's current workspace. A workspace switcher
  would require a new backend/product contract and would delay the first run.
- **Keep task ownership explicit:** use an existing caller-managed task or create
  one through the keyed task endpoint. Do not add task-free sessions or infer
  execution rights from human assignment.
- **Reliable initial retry:** recommend a separately scoped initial-session
  requestId/receipt design before claiming exactly-one launch after a lost response.
  That is a proposed follow-on, not implemented here. A minimum demo can run with
  one submission and an honest unknown-outcome state; it cannot promise safe retry.
- **Live browser authentication:** preserve the already explicit cookie/BFF gate.
  Same-origin proxying alone does not turn bearer tokens into a safe browser session.
  Agree the service-owned transport/security contract before replacing the unavailable
  adapter. Do not persist credentials in local/session storage or choose a memory-only
  trial silently.
- **Project creation:** prefer an existing READY project first, then empty creation.
  Template materialization and existing-directory handling remain visible optional
  paths with their actual prerequisites and explicit destructive-choice rules.

## End-to-end acceptance matrix

These are proposed browser/integration gates, not claims they already ran.

| Gate                     | Acceptance test                                                                                                                    | Local backend evidence to reuse                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Login to selection       | Login → self/grants/current workspace → READY project → caller-managed task; no automatic mutation on reads                        | auth.service, auth.guard, authentication-availability, task-project HTTP/service tests         |
| Zero/revoked authority   | Zero grants, foreign workspace, public nonmember, readable-but-other-manager task; revoke immediately before spawn                 | session-deletion HTTP, session-directory-policy, sessions.service tests                        |
| Setup validity           | Unsupported effort, notREADY/archived project, missing/symlink/out-of-root/unwritable directory remain actionable; inputs retained | model-catalog HTTP, session-directory-policy, task-project tests                               |
| Controlled first run     | Exactly one click/request;201 IDs persisted; queued/running/output/server completion displayed without human-task confirmation     | session-deletion HTTP, sessions.service, proboxai-runner, safe-session-event tests             |
| Lost initial response    | UI shows unknown and inspect-session recovery; no automatic replay or fake request receipt                                         | Contract limitation above; add browser network-fault test without asserting server idempotency |
| Follow-up uncertainty    | Drop acknowledgment, reconcile same requestId and prompt; no duplicate turn, changed input409                                      | session-deletion HTTP lost-response/dedup tests                                                |
| Reconnect/expiry         | Disconnect at a sequence boundary, refresh if needed and replay from last applied sequence; no duplicate/missing rendered items    | session-deletion HTTP SSE replay, expiry, revocation and terminal-event tests                  |
| Stop/restart             | Target old turn after a new one exists; no wrong signal. Interrupted owner-loss stays STOP_UNCONFIRMED with follow-up blocked      | session-deletion HTTP and sessions.service lease/interrupt tests; Telegram stop-evidence tests |
| Create then execute      | Keyed empty project and keyed task recover after lost ack; optional board link; manager starts only afterREADY                     | project-enqueue-recovery HTTP, task-creation HTTP, human-task-actions HTTP tests               |
| Real deployment/provider | One separately approved harmless run through actual browser/proxy/provider, with observed target version and cost scope            | Unverified; mocked runners and static catalog cannot close this gate                           |

## Smallest next implementation batch

After the browser-session/origin contract is approved, wire the **existing sign-in
form → real session adapter/bootstrap → protected current-workspace screen → eligible
project/task selectors**, with401/503/expiry handling and no run yet. Add one controlled
browser journey using a pre-existing OPEN account and seeded eligible project/task,
plus invalid credentials, no grants and stale/revoked identity cases. This reuses
the completed authentication UI instead of rebuilding it. It does not require
avatar storage, project creation, template execution or live provider credentials.
Follow immediately with catalog/preflight/start/read/output through a controlled
runner, and then creation/reconnect/stop cases above.

Initial-start reconciliation remains a **proposal**, not approved implementation.
The current DTO has no requestId, and the existing session-project-deletion contract
explicitly excludes initial request-ID idempotency. No later approval was found in
the inspected backend documentation or frontend decisions. Proposed next backend
contract: optional retained client UUID, caller/workspace-scoped original session /
initial-turn receipt, identical replay returning the same acknowledgment, changed
input409 and atomic same-key concurrency. Agree receipt read authority/lifetime and
legacy behavior before implementing. Verification must drop the response after
commit, race identical requests, change an input, revoke access and confirm one
session/initial turn and no automatic prompt replay or duplicate launch. This plan
does not add that endpoint, migration or execution behavior.

## Current evidence and what has not been verified

- Backend: the latest local frozen-source run passed **1,195 tests in65 suites**;
  typecheck/lint/format/build/release and172-operation contract checks pass.
- Frontend: inspected source confirms implemented auth UI and its deliberate
  unavailable production composition. Existing16 October reports record53 unit/
  tooling tests and11 browser groups with9 axe checks, plus later feedback cases,
  using local contract simulation. These are historical reports, not rerun here
  or proof of live authentication/accessibility conformance.
- Frontend source evidence: `src/app/routes.ts`, `src/app/routes/auth.tsx`,
  `src/features/authentication/ui/Authentication.tsx`,
  `src/features/authentication/api/auth-api.ts`,
  `src/features/authentication/model/auth-contract.ts`,
  `src/shared/config/public-env.ts`, `docs/decisions/ADR-003-authentication-boundary.md`,
  `docs/features/authentication.md`, `authentication-verification.md` and
  `authentication-ui-feedback.md` in the frontend checkout.
- No live login, cookie/BFF session, authenticated destination, real browser-to-backend
  complete journey, proxy/SSE deployment or paid provider run is verified by this
  inspection. No frontend command that could write generated files was run.

Source anchors: `src/auth/auth.controller.ts`; `src/accounts/accounts.controller.ts`;
`src/authorization/authorization.controller.ts`; `src/projects/projects.controller.ts`;
`src/tasks/tasks.controller.ts`; `src/tasks/human-tasks.controller.ts`;
`src/tasks/human-task-actions.controller.ts`; `src/sessions/sessions.controller.ts`,
`dto.ts`, `sessions.service.ts`, `session-projections.ts`, `proboxai-runner.service.ts`;
`src/main.ts`. Supporting contracts:
[directory/context](session-directory-context-contracts.md),
[durability](session-durability-contracts.md),
[assistant snapshots](session-assistant-text-contracts.md),
[safe command metadata](session-command-disclosure-contracts.md),
[project creation recovery](project-creation-readback-contracts.md),
[task creation recovery](task-creation-recovery-contracts.md),
[current readiness inventory](frontend-readiness-20261018.md).

No frontend, auth/session semantics, database schema, grants, runtime credentials,
live settings or deployment was changed to produce this plan. Telegram UI changes
and this batch's final verification are recorded in the
[bot handoff](telegram-bot-ui-batch.md). Postman remains blocked and was not retried.

## Review-only transport and initial-create drafts

The [same-origin browser-session/BFF proposal](browser-session-bff-proposal.md)
and [initial-session-create receipt proposal](initial-session-create-receipt-proposal.md)
record concrete contracts, owner choices, isolated tests and implementation order.
Both remain unapproved and unimplemented. Postman documentation approval does not
approve either transport, persistence, retention or revocation change.

## Existing-contract login/setup integration evidence — 18 October

Added `test/login-session-setup.http.spec.ts`: real AuthService password
verification, JWT issuance/verification and persisted identity/grant guards connect
login → self/authorization → scoped project/task discovery → configured model
catalog → execution context → directory preflight. It uses synthetic accounts,
the explicitly isolated loopback profile_test database and checked temporary paths.
No browser/BFF adapter, initial-create receipt, application route, service, DTO,
configuration or migration is changed in this increment.

The12 tests cover invalid/expired credentials, revoked grants, BANNED identities,
foreign workspace and other-manager tasks, visible public project versus execution
authority, removed membership, not-ready/archived projects, missing/out-of-project
paths, forbidden selectors, authentication dependency503 and filesystem denial.
Each test verifies zero session/turn rows in fixture workspaces, zero session-create
service calls, zero runner start/interrupt calls and zero Telegram calls. Only
unused external collaborators and background maintenance startup are replaced;
login, guards, scope queries, catalog and filesystem policy execute real code.
Refresh tokens are synthetic and their database records contain hashes only.

Historical gap (superseded by the correction below): login account lookup and refresh-token persistence dependency
failures currently return Nest's generic500, while protected authentication reads
return sanitized503. A characterization test records that difference and recovery;
no functional correction or new503 login contract is implemented. Frontends must
not label such an outage as invalid credentials or automatically retry a domain
mutation. BFF/initial-create approval gates and live-provider restrictions remain.

The new suite passed12/12 against PostgreSQL. Combined authentication-availability,
auth-guard, task/project and directory-policy verification passed **111 tests in
five suites**. Typecheck, targeted ESLint/Prettier and `git diff --check` pass.
The prior full1213-test run predates these12 added tests; no new full-suite run is
claimed for this test-only increment. Synthetic records and temporary directories
were cleaned, and the isolated PostgreSQL instance was stopped afterward.
This does not establish browser authentication,
provider availability, session execution or deployed readiness.

## Login dependency availability correction — 18 October

Known login database/service availability failures now return the existing exact
503 body `{statusCode:503,message:"Authentication is temporarily unavailable",
error:"Service Unavailable"}`. Conversion wraps only username lookup and refresh
token persistence. Normalization, password verification, invalid credentials,
registration/reset/refresh and JWT signing are outside this new boundary.

The Prisma6 allowlist is P1000/P1001/P1002/P1003/P1008/P1010/P1011/P1017
(connection, configuration or timeout), P2024/P2037 (pool/capacity), Prisma client
initialization errors and explicit ServiceUnavailableException. Database server
credential failure is infrastructure failure, distinct from a bad user password.
Constraint/state errors, explicit business exceptions, validation/query misuse
and unclassified/programming failures retain their prior handling; no blanket
whole-login catch or new error-code vocabulary is introduced. The source-grounded
code definitions are in the versioned [Prisma6 common errors](https://github.com/prisma/prisma-engines/blob/6.19.0/libs/user-facing-errors/src/common.rs)
and [query-engine errors](https://github.com/prisma/prisma-engines/blob/6.19.0/libs/user-facing-errors/src/query_engine/mod.rs).

Neither credentials nor raw errors/metadata appear in the503 response. Lookup
failure performs no write. Refresh persistence must resolve successfully before
access signing and credential delivery. A connection error after commit may leave
a normal expiring hash-only refresh record;503 does not promise rollback. The
PostgreSQL lost-ack test proves no successful response/access signing in that case.
No automatic retry, token rotation, logout/revocation change or cleanup policy is
added. A later explicit login may succeed after dependency recovery.

Runtime changes: `src/auth/authentication-failures.ts`, `src/auth/auth.service.ts`
and the login OpenAPI decorator in `src/auth/auth.controller.ts`. Focused tests:
`test/login-availability.http.spec.ts` and updated
`test/login-session-setup.http.spec.ts`. Login HTTP tests also prove synchronous
failures, preserved401/400/409/500 behavior, no signing on failed persistence and
unchanged success lifetime/hash-only storage. The earlier integration
characterization now expects503 for typed availability failures, while explicit
unknown/programming errors remain500 in focused coverage.

Local OpenAPI/inventory/request-description templates/offline reference and
continuation-plan source hashes were regenerated only by local scripts. No cloud
Postman request or approval retry occurred. The tool-review blocker remains.
No migration, BFF, initial-create receipt, deployment or provider execution change.
Focused verification passed78 tests in three suites. The full run passed1258 of
1259 tests (68 of69 suites); the unrelated six-identical-request task-creation
concurrency test received503 instead of201 once. Its cause was not established.
The unchanged task-creation suite and all login/auth/integration suites then passed
**107 tests in five suites**, including13 real-PostgreSQL setup tests and the lost
write acknowledgment. No task runtime/test was modified. This is not a claim of
a fully green full run; the intermittent task result remains separate evidence.
Typecheck, lint, formatting, build, release checks and all172 API-operation checks
pass. The isolated test database was stopped; synthetic fixtures/temp paths were
cleaned and protected-file hashes match. Local work remains uncommitted.

## Task-creation concurrency investigation — 18 October

The original1258/1259 full-run failure and prior passing rerun remain preserved
with SHA256 manifests in the local Temp evidence directory recorded in
[the investigation report](task-creation-concurrency-evidence.json). The original
response body was not captured. During that serial task-suite interval, PostgreSQL
logged Windows1450 and failure to open `base/16384/17429` for a UserRoleAssignment
query. A read-only catalog query identifies that file as
`UserRoleAssignment_assignedById_idx`, currently valid and ready. Microsoft defines
1450 as insufficient system resources; the source link and timestamps are retained
in the report. This supports host/database availability as the failure category.
The exact exhausted resource/consumer and original HTTP error boundary remain
unconfirmed; no claim of a fixed host issue or absence of every possible race.

Five bounded repetitions of the two unchanged concurrency expectations passed:
10 selected cases,30 identical-key submissions and10 changed-input submissions.
The task-creation suite plus task/project, mutation concurrency, administration
concurrency and real-login/setup suites passed102 tests across five suites. No new
Windows1450 entries appeared during the investigation. These passing runs alone
do not establish a fix; the preserved database log provides the independent lead.

Changed only `test/task-creation.http.spec.ts` and documentation/evidence. Every
original201/body equality/single-task/single-receipt assertion is retained. An
additional response-context assertion exposes future503 bodies, and a controlled
Prisma authorization-read failure verifies sanitized503, zero writes and explicit
same-key recovery/replay to one task/receipt. That injection checks failure handling,
not actual OS-resource exhaustion. No application timeout, retry, isolation level,
row lock, storage, host/security setting or receipt contract was changed.
Typecheck, targeted lint/format and diff checks pass. Isolated PostgreSQL was
stopped after verification; existing work and previous holds remain intact.

## Frontend session developer handoff for19 October

Use [the runnable handoff](frontend-session-handoff.md) and
[captured API/SSE examples](api/frontend-session-examples.json).
`pnpm handoff:prepare` verified34 existing migrations with no pending migrations.
`pnpm handoff:verify` executed23 requests/streams, including initial completion,
follow-up completion/conflict and targeted interruption; it observed seven initial
SSE events and three controlled fake runner generations, with zero provider calls.
`pnpm handoff:serve` exposes the same real API/guards/services at loopback3050 with
synthetic identity, project/task and checked temporary paths. Only the exact
isolated profile_test URL is accepted, and normal shutdown cleans its fixtures.

Existing contracts remain: no new cookie/BFF endpoint, initial-create receipt,
workspace switcher, task-free execution or raw tool/diff disclosure. The frontend
can build selection/setup/session/history/recovery screens now against controlled
responses and the API. Production browser sign-in composition remains the explicit
transport-policy gate; initial-start unknown outcome remains visible without an
automatic resubmit. No optional design question stops the local path.

This new journey uncovered a separate real session deadlock at23:43:36 +05:
follow-up admission/interruption locked workspace/task before session, while runner
event persistence locked session first. PostgreSQL logged that cycle; the
controlled regression physically locked workspace and proved the old event path
held session (NOWAIT55P03). The failing-before log is retained at
`C:/Users/user/AppData/Local/Temp/proboxai-session-lock-order-before.log`.
Event persistence now calls the same lockRun order used by the other writers.
No retry, error-body or DTO policy change. This session issue is distinct from
the earlier task-test Windows1450 resource failure.

The controlled real HTTP/SSE, lock-order, acceptance/deletion and service tests
passed95 tests in three suites after the fix. Final unchanged-source full verification passed **1268 tests in70 suites**.
Typecheck, lint, formatting, build, release and all172 API checks passed.
[Machine-readable evidence](api/frontend-session-readiness.json) records capture
counts and hashes of failing-before and passing-after logs. Isolated PostgreSQL
is stopped, fixture data/directories are cleaned and protected-file hashes match.
Earlier resource/concurrency failure evidence remains intact.
