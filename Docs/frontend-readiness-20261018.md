# Frontend backend readiness inventory — 18 October 2026

This is the current local integration inventory for the preserved `dev` patch,
package `0.3.0-dev.10`, base `13f4b6f18a6a2bb310ec79f41d99ce4a12e0db90`.
It supersedes missing-feature statements in older reviews only for the bounded
contracts linked here. The parent owns shared checklist acceptance. A successful
schema check does not close a product requirement or prove frontend integration.

## Local, deployed and Postman evidence

| Surface                                | Evidence                                                                                                                                                                                          | What it establishes                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current local source                   | [OpenAPI](api/openapi.json), [172-operation inventory](api/endpoints.json), 27 registered controller classes                                                                                      | Current route, input/output and declared permission contracts; uncommitted local changes included                                                                                                                                                                                                               |
| Local execution                        | Isolated PostgreSQL HTTP/persistence tests plus mocked storage/provider/messaging boundaries; verification below                                                                                  | Tested local behavior and specific authorization regressions, not every operation executed against a deployed service                                                                                                                                                                                           |
| Deployment                             | Release catalog marks development snapshots `not-deployed`; no deployment or target endpoint verification in this work                                                                            | No current target version, runtime reachability, avatar bucket privacy or frontend wiring claim                                                                                                                                                                                                                 |
| Historical private Postman publication | [Readback evidence](api/postman-publication-result.json), [saved plan](api/postman-sync-plan.json); 17 October, `0.3.0-dev.9`, commit `fde9cc268b0a49274eb196ddb3b7f3b5e9900137`                  | 161 saved requests covering 160 operations in ten existing personal collections, with 81 original requests and 114 saved examples preserved                                                                                                                                                                     |
| 18 October partial Postman refresh     | [Fresh readback and blocker](postman-refresh-20261018.md)                                                                                                                                         | Personal workspace/ten collections verified;40 existing descriptions updated,121 and12 new routes pending after automatic review again rejected continuation despite direct user approval. Remote coverage remains161 requests/160 operations; all original execution settings and114 saved examples preserved. |
| Current local request templates        | [172 operation descriptions](api/postman-operation-docs.json), [offline collection](api/postman-current-local.collection.json), [exact continuation plan](api/postman-refresh-20261018-plan.json) | Prepared source-derived documentation with placeholders; no captured successful runtime responses or deployment evidence                                                                                                                                                                                        |

Comparing normalized method/path keys from the historical publication plan with
the current inventory gives **12 local-only operations**: five avatar upload,
reconciliation, preview, discard and public-delivery routes, plus seven shared-task
association/state/workflow/receipt/creator-confirmation routes. No historical route
is absent from the current inventory. Existing routes also have changed local
schemas: profile media/status, strict profile selectors, safe command metadata,
authorization reads, readiness/catalog and project error contracts. A route present
in both snapshots therefore does not imply its latest contract is published.
The original audit made no cloud changes. A later18 October documentation task
verified the current collections and updated16 descriptions before automatic
approval review rejected further nonpublic-contract disclosure. That partial
refresh does not publish the twelve new routes or establish deployed availability.
No application requests were sent through Postman; environment values were not read.

## Available bounded backend surfaces

All paths in the linked contracts are relative to `/api/v1`. Counts are operations,
not screens or completed checklist items. Tests named below contain focused
behavior/authorization evidence; they do not claim exhaustive per-route coverage.

| Family (operations)                    | Locally available integration                                                                                                                                                                              | Evidence and remaining boundary                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account/profile (32)                   | Authoritative self read, independent names/admin creation, bio/date-only birthday, audience evaluation, Contacts/aliases/picker, atomic Save, shared manual availability, custom status and staged avatars | [Atomic Save](atomic-profile-save-contracts.md), [media/status](profile-media-status-contracts.md); profile-save, profile-picker, profile-media-status and profile-avatar-failures HTTP suites. Main Save publishes; editor Done stages. Avatar live storage remains deferred. Username/phone editing and Telegram unlink/recovery are not supplied.                         |
| Authentication/authorization (20)      | Existing sign-in/OTP/refresh/link-state contracts; current persisted identity/grants, role/catalog administration                                                                                          | [Authorization reads](authorization-read-contracts.md); authentication-availability, auth.guard, admin-department HTTP suites. No new sign-out/revocation policy or agent principal.                                                                                                                                                                                         |
| Projects/initializations/settings (44) | Existing scoped projects, creation/enqueue recovery, member picker/archive, file/trash/deletion operations, initialization history/events/retry/cancel, extension protections and legacy home settings     | [Enqueue recovery](project-enqueue-recovery-contracts.md), [persisted responses](persisted-response-contracts.md), [file journal](file-deletion-journal-contracts.md); project-enqueue-recovery, project-member-picker, file-template and persisted-response HTTP suites. Cancellation is not proof of descendant exit; journal reconciliation is not OS writer containment. |
| Human tasks/boards/deadlines (40)      | Existing original-project lists/details, assignments/comments/checklists/workflow/deadlines, explicit share foundations, minimal shared-state and creator-only one-way confirmation                        | [Human collaboration](human-task-collaboration-contracts.md), [boards](task-board-status-contracts.md), [shared tasks](shared-human-task-contracts.md); human-task-actions, task-boards, task-deadlines and shared-tasks HTTP suites. Shared destination content/history and reopening are not available. Column/runner success does not confirm human completion.           |
| Sessions (11)                          | Assigned-manager session index/read, durable acceptance/history/events, recovery/interrupt state, managed model catalog and provisional command metadata                                                   | [Durability](session-durability-contracts.md), [command disclosure](session-command-disclosure-contracts.md), [catalog](readiness-catalog-contracts.md); session-deletion, safe-session-event and model-catalog HTTP/unit suites. Raw terminal output, historical file bytes and interactive approvals remain outside the implemented contract.                              |
| Configuration templates (13)           | Existing scoped manifest/version/command/file/publish lifecycle and limits                                                                                                                                 | file-template HTTP/OpenAPI, template-command persistence and template-storage-errors suites. Tests substitute object storage; no live bucket verification.                                                                                                                                                                                                                   |
| Departments (7)                        | Existing revision-safe department administration, default/home constraints                                                                                                                                 | admin-department HTTP/OpenAPI and admin-concurrency persistence suites. Nested/shared-home policy is not broadened.                                                                                                                                                                                                                                                          |
| Chat group metadata (3)                | Existing metadata-only group create/update/operation readback                                                                                                                                              | chat-groups HTTP suite. This does not establish discussion messages, unread counts, receipts, attachments, polls or presence.                                                                                                                                                                                                                                                |
| Health (2)                             | Liveness and sanitized dependency readiness                                                                                                                                                                | health HTTP suite with dependency mocks. Green readiness concerns PostgreSQL/template storage only, not avatar bucket, runner or feature availability.                                                                                                                                                                                                                       |

Standard JSON errors use `statusCode/message/error`, sometimes optional domain
fields; do not require a code on every error. HTTP status remains authoritative.
401 credential rejection, 403 denied permission, 404 unavailable resource, 409
conflict, 428 missing revision and 503 dependency failure must stay distinguishable.
For receipt-backed mutations preserve the request identity, original revision and
draft after uncertain outcomes; use the specific operation readback. Do not
generalize idempotency to arbitrary writes. The Telegram webhook intentionally
returns empty200 even for quiet secret rejection; it has no bearer-token 401 flow.

## Fresh bounded audit and correction

The audit inspected every exported path parameter, nonempty200/201/202 response
schema, declared error schema/media type, bearer error declaration and route count, then traced missing declarations
to the existing guards/services and regression suites. No missing path declaration,
untyped nonempty success or generic object success was found. Ten protected routes
lacked their existing error declarations: initialization list/detail/retry (3),
protected-extension CRUD (4), and file-operation list/read/reconcile (3).

These routes now document the established authentication, resource and validation/
unexpected-failure envelopes. The stronger verifier also exposed 79 declared error
responses whose schemas were overwritten/omitted by revision or operation-specific
decorators, plus 21 errors on three stream/download operations labelled with the
success media type. Those declarations now retain the standard envelope; SSE and
binary success media are declared independently from JSON errors. Domain `code`
is an optional open string, matching `operationError(code: string)` and existing
manual/profile errors omitted by the old closed enum. This does not add or rename
runtime codes; use each operation's specific code guidance.

Runtime payloads, guards, permissions and service behavior are unchanged.
New HTTP regressions exercise all ten routes and the three stream/download routes with missing
credentials, persisted zero grants despite forged token permission claims, and
authentication database failure. They verify 401/403/sanitized503 before handlers
execute. Existing isolated tests retain membership, owner and workspace checks.
The documentation verifier now rejects missing access-token401/403/503 declarations,
missing JSON schemas for every declared4xx/5xx response and missing required path declarations,
alongside its existing success-schema,
webhook, embedded-reference, body/header and upload checks.

This audit found no further independently actionable implementation gap in its
bounded contract/error inventory after correction. It is not an exhaustive audit
of every product proposal or a claim that all 40 historical checklist umbrellas
are complete. Older conditional proposals remain unselected until decided.

## Remaining choices and enablement boundaries

| Scope                         | Specific unresolved boundary                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avatar enablement             | Existing private avatar bucket and authorized principal must be verified by an operator before media enablement. Provisioning/credential work is deferred; no reminder or live storage operation is scheduled. Non-media work is independent. |
| Shared-task mirror            | Select destination content/comment/audit visibility and edit/removal propagation. Minimal association/state is not a full shared-card read contract.                                                                                          |
| Completion                    | Reopening is unselected. Creator-only manual one-way confirmation and employee ownership of future agent-created-on-behalf work remain established. No active agent task-creation adapter exists.                                             |
| Account/security              | Username/phone edits, sign-out and access-versus-refresh/per-device revocation, Telegram unlink/relink/recovery, optional password/preferences/OTP-timer requirements need selected contracts.                                                |
| Execution disclosure/recovery | Nonempty command/tool output and historical file diffs need trustworthy sources and a selected disclosure contract. Interrupt acknowledgment is not confirmed stop; do not replay prompts automatically.                                      |
| Agent authority               | Employee-linked credentials, delegation/approval and live actor/provenance adapters remain inactive foundations. No autonomous final approval or administrative bypass is implied.                                                            |
| Discussions/notifications     | Conversation membership/history/receipts, unread/activity models, rich references/attachments, notifications/polls/media and presence require selected data/disclosure contracts. Group metadata/manual availability do not fill these gaps.  |
| Files/departments/articles    | Broader writer containment/restore guarantees, nested/shared homes and Space article hierarchy/rich blocks/history/media/embed policy remain explicit decisions, not automatic follow-on implementation.                                      |
| Optional UX/query features    | Saved personal views/defaults, relevance ranking, cross-section snapshots and general helper/request-access disclosure remain conditional proposals. No inferred new route or grant.                                                          |

## Changed files and verification

```text
src/projects/project-initializations.controller.ts
src/projects/projects.controller.ts
src/accounts/manual-status.controller.ts
src/accounts/profile-avatar.controller.ts
src/accounts/profile-save.controller.ts
src/openapi/api-docs.ts
src/openapi/revision.ts
src/sessions/sessions.controller.ts
src/tasks/shared-tasks.controller.ts
src/tasks/tasks.controller.ts
scripts/verify-api-docs.mjs
test/project-error-contracts.http.spec.ts
Docs/frontend-readiness-20261018.md
Docs/backend-ui-handoff.md
Docs/backend-overnight-gap-review.md
Docs/profile-gap-review-20261018.md
Docs/api/README.md
Docs/api/openapi.json
Docs/api/endpoints.json
Docs/api/postman-operation-docs.json
```

Focused verification passed **49 tests in three suites**, including five new
schema/HTTP cases. All 172 operations pass contract/reference/body/header checks;
all **1,107 declared error responses** have JSON schemas, with zero missing schemas
or wrong media types. OpenAPI syntax lint reports no issues. Typecheck, lint,
formatting, build, release checks and `git diff --check` pass. Prisma validation
passes; all 34 existing migrations are current in the isolated loopback database.
The final full regression run passed **1,184 tests in 65 suites** against the
frozen application/test source, including existing workspace/owner, authorization,
receipt, concurrency and persistence regressions. The isolated test database is
stopped afterward, with its data directory retained. Protected README and
linked-agent assessment SHA256 hashes are unchanged.
No new migration, product policy, service implementation or grant is introduced.
The three earlier local migrations remain uncommitted and are not production
changes. Existing dirty work and protected user files are preserved. No push,
deployment, production migration, credential provisioning or cloud publication.
