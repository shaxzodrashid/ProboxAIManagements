# Frontend development through sessions

The backend can be exercised locally from real password login through session
creation, persisted assistant output, SSE, completion, follow-up and interruption.
Use the controlled harness below: it runs existing controllers, guards, services
and PostgreSQL with an in-process fake runner. It never starts an agent, shell,
Telegram delivery or paid provider. The fake output is labelled as a fixture.

This is enough to build the project/task/setup/session screens and their request
adapters. The production browser sign-in adapter remains gated by the existing
browser-session decision; keep it injectable rather than storing bearer tokens
in browser storage to bypass that decision. No decision about initial-create
receipts is needed to support one deliberate submission with honest recovery.

The fixture supports the journey below. It is not an avatar/storage, Telegram OTP,
admin or deployment-readiness environment; use the full local OpenAPI for those
separate contracts. No synthetic health result stands in for live infrastructure.

## Run on this laptop

Prerequisites: the installed Node/pnpm dependencies and the existing isolated
PostgreSQL fixture at127.0.0.1:55439, database/user `profile_test`. The harness
rejects every other URL, including added connection query parameters. It never
falls back to `DATABASE_URL`, reads a live account or provisions credentials.

```powershell
# From D:\Shakhzod\Javascript\ProboxAI
$env:PROFILE_TEST_DATABASE_URL='postgresql://profile_test@127.0.0.1:55439/profile_test'

# Start only if this isolated instance is stopped.
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' `
  -D 'C:/Users/user/AppData/Local/Temp/proboxai-atomic-profile-pg-20261016/data' `
  -l 'C:/Users/user/AppData/Local/Temp/proboxai-atomic-profile-pg-20261016/server.log' `
  -o '-h 127.0.0.1 -p 55439' start -w

pnpm handoff:prepare  # existing migrations, exact isolated target only
pnpm handoff:verify   # runs real HTTP/SSE journey; captures sanitized examples
pnpm handoff:serve    # loopback port3050; prints current fixture manifest
# Optional alternative: pnpm handoff:serve --port=3051
```

`handoff:prepare` applies repository migration files only to that explicitly
allowlisted test database. It creates no database user or deployment secret.
`handoff:serve` creates synthetic fixture identity, ready project and managed task.
Its manifest supplies baseUrl, username, synthetic password, workspace/project/task
IDs and temporary directory. These are development fixtures, not real account
credentials. JWT signing material is generated in process and never printed.

Keep that terminal running; use its current manifest in a second terminal:

```powershell
$base='http://127.0.0.1:3050/api/v1'
$credentials=@{username='<manifest username>';password='<manifest synthetic password>'}
$login=Invoke-RestMethod "$base/auth/login" -Method Post `
  -ContentType 'application/json' -Body ($credentials | ConvertTo-Json)
$headers=@{Authorization="Bearer $($login.accessToken)"}
Invoke-RestMethod "$base/users/me" -Headers $headers
Invoke-RestMethod "$base/projects" -Headers $headers
Invoke-RestMethod "$base/tasks" -Headers $headers
```

Ctrl+C stops the server and cleans only its fixture workspace and checked temporary
directory. An abrupt process kill may retain fixture rows; inspect that manifest
instead of deleting arbitrary workspaces. The PostgreSQL instance can be stopped
afterward with the same `pg_ctl -D ... stop -m fast -w` command.

## Verified examples and source contracts

- [Captured HTTP and SSE examples](api/frontend-session-examples.json): executed
  against the controlled fixture, with access/refresh/password values redacted.
  UUIDs and timestamps belong to a completed ephemeral run; use the running
  manifest for new requests. Examples are not evidence of a deployed backend.
- [OpenAPI](api/openapi.json): complete DTOs and existing permissions for all172
  operations. [Endpoint inventory](api/endpoints.json) is the route index.
- [Lifecycle integration tests](../test/frontend-session-journey.http.spec.ts)
  cover actual HTTP, SSE/reconnect, replay/conflicts, completion and interruption.
  [Setup tests](../test/login-session-setup.http.spec.ts) cover current grants,
  isolation, denial and dependency failures before execution.

## Request sequence

| Step               | Request                                                                            | Successful result and frontend behavior                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in            | `POST /auth/login` with `{username,password}`                                      | 200 `{accessToken,refreshToken}`. Existing bearer contract: access30 minutes; refresh30 days and not rotated. Controlled Node/client fixture only until browser transport is approved. |
| Identity           | `GET /users/me`; `GET /authorization/me`                                           | Profile and current persisted workspace/grants. Render displayName; do not split legacy names. No selectors. Zero grants is a valid authenticated state.                               |
| Discover           | `GET /projects`; `GET /tasks`; `GET /tasks/:id`                                    | Scoped reads. A visible public project is not proof of execution membership. A human assignee or creator label is not assigned execution-manager authority.                            |
| Optional new task  | `POST /tasks` with `{title,description,requestId}`                                 | 201 task. Preserve UUIDv4 and exact body. `GET /tasks/creations/:requestId` reconciles this existing keyed contract. No execution starts here.                                         |
| Models             | `GET /sessions/model-catalog`                                                      | Providers contain models, defaults and supportedReasoningEfforts. Display models directly, provider secondary; only offer supported effort values.                                     |
| Execution context  | `GET /sessions/projects/:projectId/execution-context?taskId=...&sandbox=read-only` | Canonical selected-project directory, validation reason and capability observations. Requires caller-managed task and current project scope.                                           |
| Preflight          | `POST /sessions/directory-preflight` with `{taskId,projectId,sandbox:"read-only"}` | 200 with valid/reason/normalizedPath. Invalid is still a200 observation. Preserve entered values and explain reason. It neither provisions paths nor reserves execution authority.     |
| Start              | `POST /sessions` with the body below                                               | 201 session plus initialTurn. Submit once, retain returned IDs before navigation, then read/stream. This endpoint has no client requestId reconciliation contract.                     |
| Snapshot           | `GET /sessions/:id`                                                                | Session plus chronological turns. Use persisted state for run outcome; turn executionStartedAt distinguishes execution from acceptance.                                                |
| Output             | `GET /sessions/:id/events?after=0&limit=100`; `/events/stream?after=0`             | Ordered durable events and explicit omissions. SSE carries id=sequence, event=type and data=event JSON.                                                                                |
| Follow-up          | `POST /sessions/:id/turns` with `{requestId,prompt}`                               | 202 durable acceptance. Preserve the same UUID/body for receipt lookup or identical explicit replay. Running session retains its model/effort.                                         |
| Follow-up recovery | `GET /sessions/:id/turns/by-request/:requestId`                                    | Minimal current persisted acceptance, using sessions.manage. Changed reuse and another active turn are409.                                                                             |
| Stop               | `POST /sessions/:id/interrupt` with `{turnId}`                                     | 200 interrupted/requestedAt/signalAcceptedAt/stopConfirmation. Signal acceptance is not confirmed stop; reconcile snapshot/history.                                                    |

All paths above are relative to `/api/v1`. Selection and creation remain scoped to
the current workspace and assigned manager; no workspace switcher or new grant is
needed. The fixture grants projects.read, tasks.create/read and
sessions.create/read/manage. Backend resource checks still apply on every action.

Start body using a returned catalog entry:

```json
{
  "taskId": "<current managed task UUID>",
  "projectId": "<current selected project UUID>",
  "prompt": "The user's exact initial task",
  "sandbox": "read-only",
  "providerId": "<provider.id>",
  "model": "<model.id>",
  "reasoningEffort": "<one of model.supportedReasoningEfforts>"
}
```

Omit cwd to use the selected project's canonical directory. Manual directories
still require a task and allowed-root preflight; there is no arbitrary filesystem
browser or task-free session contract. Changing model resets a pending setup effort
to that model's default. Keep model choices as a UI draft until the user confirms
the setup; catalog support does not verify provider credentials or availability.

## State, output and list rules

The create response currently records session.status=RUNNING while
initialTurn.status=QUEUED and stopConfirmation=NOT_STARTED. Treat this as accepted
registration, not proof of a spawned child. The server subsequently records turn
executionStartedAt and RUNNING. `turn.completed` from the runner is not the final
authority: wait for a SERVER `session.state` event or a session snapshot showing
COMPLETED/FAILED/INTERRUPTED. Transport EOF does not establish completion.

Render assistant output from `event.data.item` and its textUpdate metadata.
Verified assistant messages are complete snapshots, not token deltas. Deduplicate
events by sequence; replace the same item revision instead of blindly appending
fragments. Do not fabricate omitted tool output, reasoning, command text or diffs.
For command disclosures, use only returned allowlisted labels/fields.

History returns events, nextCursor, highWaterSequence, hasMore and a session
snapshot. Advance using nextCursor; retain untilSequence for a fixed REST boundary.
SSE reconnects with after or Last-Event-ID; both must agree if supplied. A fixed
untilSequence belongs only on REST history. Reauthorization and access expiry can
end streams; bootstrap/reconcile after reconnect rather than restarting a run.
Existing bearer streaming needs fetch with an Authorization header; native
EventSource cannot supply it. A future cookie adapter must preserve sequence rules.

`GET /sessions?taskId=...` and global session paging work for caller-managed tasks.
Project-filtered listing additionally follows the task's explicit board association;
selected execution project alone does not create that association. Do not hide a
new session merely because it is absent from that narrower project-filtered list.
List statuses are persisted observations, not complete live-process counts.

## Error and retry behavior

| Outcome             | Frontend action                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400                 | Keep user input. Show field/path validation; use only supported model/effort and valid UUID/cursor values.                                                                                                                                                                                                                                |
| 401                 | Distinguish bad login credentials from an expired/missing access credential. Reauthenticate through the selected transport; never replay a domain mutation automatically.                                                                                                                                                                 |
| 403                 | Current permission, membership or manager check denied the action. Refresh context; role names do not override denial.                                                                                                                                                                                                                    |
| 404                 | Missing or unavailable scoped resource; do not infer that another workspace's item exists.                                                                                                                                                                                                                                                |
| 409                 | Active turn, changed request-ID reuse, stale interruption target, archive state or invalid history boundary. Reconcile the specific resource and keep the original command.                                                                                                                                                               |
| 503                 | Dependency or outcome uncertainty. Login uses sanitized “Authentication is temporarily unavailable” for known dependency outages. Follow-up uncertainty retains UUID/prompt and uses its receipt. Initial create uncertainty has no receipt: inspect session lists/history and ask the user to reconcile before another deliberate start. |
| 500 or network loss | Preserve the command and treat a mutation outcome as unknown. Never manufacture a new request ID/session to conceal uncertainty.                                                                                                                                                                                                          |

Disable duplicate Start submission while pending. A lost initial201 can leave a
registered session; a task-filtered list can help inspect candidates but is not an
exact original-request receipt. This limitation does not block a normal single
submission. The separate initial-create proposal remains unimplemented.

Stop controls target the observed turnId. STOP_UNCONFIRMED blocks new work under
the existing contract. LOCAL_EXIT_OBSERVED is local evidence, not a claim that all
descendant processes stopped. The harness observes its own fake generation only.

## Remaining boundaries

The production browser-session/BFF transport remains the genuine auth integration
gate. The fixture is an existing bearer API, not a new cookie contract, CORS change
or production login adapter. Build the screens and data adapters against the local
fixture/captured examples now; keep transport composition separate. The BFF draft
already proposes defaults, so optional route naming or cosmetic choices need not
delay independent work. Approval is still needed before selecting new cookie,
token-storage and revocation policy. No credentials or deployed settings are needed
for the local controlled journey.

Initial-create receipts remain a separate optional reliability increment. Avatar
bucket provisioning, discussions, notifications, presence, mirror content policy
and full command/diff disclosure do not block the first session UI path.

Provider/runtime entitlement, production proxy/SSE behavior and a paid/live-agent
run are not verified by this harness. Postman is still denied by tool review after
explicit approval; all documentation here is local and no retry is requested.

The controlled journey exposed a real event/admission lock inversion. Event writes
now use the existing workspace → task → session order. The regression failed with
an actual PostgreSQL NOWAIT lock error before the correction; its result and final
verification are recorded in the linked readiness plan and tests. No migration or
new session contract was needed.

## Final verification

The frozen local patch passed **1269 tests across70 suites**, including the
controlled HTTP/SSE journey, follow-up/interrupt behavior and lock-order regression.
Typecheck, lint, formatting, build, release and all172 API-operation contract checks
passed. `handoff:prepare` found34 migrations and none pending; `handoff:verify`
captured23 requests/streams with seven initial SSE events, three fake generations
and zero provider calls. Credentials in captures were checked for redaction.

[Verification evidence](api/frontend-session-readiness.json) records the exact
files/log hashes and scope. The isolated database is stopped after this run; start
it using the instructions above before serving. Existing work remains uncommitted.
No migration, deployment, push, remote Postman action or live provider run occurred.

## Final lock review and clean setup

A fresh source review enumerated admission, claim/terminal, interruption, final
spawn checks, recovery, event append and heartbeat writers. It found a remaining
session-first heartbeat lock. The physical lock regression failed on that path
before correction; heartbeat now uses the same workspace/task/session lockRun.
No assertion, lease duration or retry behavior was weakened.

The guide commands were also run against a newly initialized, empty isolated
PostgreSQL cluster: all34 migrations applied, verify captured23 examples, serve
handled real login/self reads, and Ctrl+C removed its fixture workspace. The
original database directory was untouched. Final full verification passed1269
tests in70 suites; [lock-path review](session-lock-order-review.json) is included
in the portable bundle and remains at Docs/session-lock-order-review.json in the
backend checkout.
