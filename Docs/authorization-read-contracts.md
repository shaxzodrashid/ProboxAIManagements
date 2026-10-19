# Authorization read freshness — 18 October 2026

This bounded API01/MAIN03 correction implements existing authoritative self-read
and private read freshness requirements. It introduces no new permission, role,
resource authority, endpoint, profile field, token lifetime or revocation policy.

`GET /api/v1/authorization/me` remains available to every current OPEN human
access-token account, including zero effective permissions. Its complete response
is `{id, workspaceId, roles:[{id,key,name}], permissions:string[]}`. The existing
guard reloads identity, current workspace and grants from storage on every request;
token workspace/role/grant claims are not authority. Permissions are the existing
sorted, deduplicated union; a successful empty array is verified zero grants.
This response is authorization context, not the authoritative personal profile
at `/users/me` and not proof of resource-specific membership/ownership or readiness.

The self route accepts no query selectors. Unknown account/workspace/role/grant
selectors return 400 rather than being ignored. Valid query-free clients keep the
same JSON fields. The explicit OpenAPI DTO describes required self fields and
exact role summaries, replacing the former generic object-array schema.

All six successful authorization GET responses now send `Cache-Control: no-store`:
self, workspace revision, role edit, user role assignments, permission catalogue
and workspace role list. Read/manage route gates are unchanged; no-store does not
make a privileged directory available to an ordinary user. Authentication and
resource errors keep their current semantics. This header contract concerns
successful read responses; it does not introduce a blanket error-header guarantee.

Clients reread self authorization after known access changes and replace their
old context. Keep successful zero grants distinct from loading, credential 401,
permission 403 and sanitized authentication-infrastructure 503. Do not downgrade
503 to anonymous, zero grants or permanent logout. Server resource authorization
still decides every action; this response is not a general can-perform-action API.
No cross-request snapshot or push/cache-invalidation stream is claimed.

Current source defines 37 permission keys. The historical 27-key design catalogue
must account for subsequent board, deadline, human collaboration and archive keys
before claiming complete Access coverage. Read the versioned current catalogue
and preserve an understandable unknown-key state; do not infer authority from
role names. Broader ACCESS01 task explanations/helper routing remain separate.

**Subsequent decision:** the owner approved avatar and custom-status implementation.
The [media/status contract](profile-media-status-contracts.md) supersedes the
pending avatar/status statements in this earlier decision queue. Other undecided
items and whole-checklist acceptance remain with the parent.

This batch requires no migration. Its local implementation is separate from
deployment and frontend/Figma wiring. Pending avatar/status choices, shared-task
semantics, storage writer exclusion, recovery authority and conversation/article
policies remain unselected. No shared checklist is changed by this correction.

## Remaining register reconciliation and decisions

The shared register's reviewed snapshot 81 has 40 unchecked entries. Several
describe old baselines; they are not 40 independently approved missing features.
The following list separates existing implementation from decisions/evidence
needed before another meaningful feature batch. Parent owns acceptance/status.

| IDs             | Current boundary / next necessary choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API02/03/10/12  | Names, biography, date-only birthday, audiences, atomic Save and shared availability exist. Avatar image/storage/crop/removal/delivery and custom text/emoji/expiry packages await the owner's answer, including custom-status audience. Do not make last name mandatory or infer first-name requiredness from the preview. Birthday defaults beyond retained private evaluation remain unselected; no new age gate is needed.                                                                                                                 |
| API04/09        | Select which persisted personal preferences and whether REST/Telegram model preferences must synchronize. A device theme or a selected design is not a server-preference contract.                                                                                                                                                                                                                                                                                                                                                             |
| API05/06/07/08  | Select current-password change if wanted, sign-out scope (one/all devices, access versus refresh), Telegram unlink/relink verification/recovery, and precise OTP retry/expiry metadata only if that UX is selected. Self Telegram link-state read already exists.                                                                                                                                                                                                                                                                              |
| MAIN01/02/03    | Assigned and project-scoped session reads, project identity/membership and authorized bounded task queries exist. Missing discussion/unread/activity feeds require actual conversation/read-state models. Broader ranking, Home cross-section snapshot semantics and complete-total guarantees remain choices; latest task/session updates are not an activity feed.                                                                                                                                                                           |
| ACCESS01/02     | This correction supplies fresh explicit self context, not a general can-perform-action API. Human descriptions must cover all current 37 keys and existing scopes. Ordinary-user helper routing still needs a selected minimal directory/contact disclosure and request-access workflow; privileged users/roles reads cannot be broadened silently.                                                                                                                                                                                            |
| PROJECT01       | Current `member-candidates` route already implements the approved OPEN same-workspace employee picker, membership filter, names, counts, pagination and fresh management scope. [Existing contract](project-member-picker-contracts.md) is an acceptance/reconciliation candidate, not a reason to invent another picker or re-ask settled eligibility.                                                                                                                                                                                        |
| TASK02/03/04/05 | Current one-project board/status, revision-safe human edits, priority/query/counts, multiple task assignees, single-assignee checklist completion/reorder and task/item date/time deadlines are implemented under their existing contracts. Reconcile older checklist prose with [collaboration](human-task-collaboration-contracts.md), [query](human-task-query-bio-evidence.md) and [deadline sorting](exact-deadline-sort-contracts.md). Avatar delivery, shared-task semantics and optional saved views are not created by these subsets. |
| TASK06/07       | Select immutable file/attachment-reference identity and readable-number scope, reference serialization/lifecycle, and cross-project sharing authority plus canonical versus board-local completion. No shared-task model can be inferred from one-project board entries.                                                                                                                                                                                                                                                                       |
| SESSION05       | Choose who may acknowledge/reconcile STOP_UNCONFIRMED, acceptable termination evidence and its audit/result contract. Current restart/lease/interrupt/replay behavior already exists; a signal, timeout or process restart is not proof of termination.                                                                                                                                                                                                                                                                                        |
| SESSION07       | Strict safe-only disclosure is already provisionally selected and its bounded label/exit-code subset exists. More output needs verified structured provider semantics and a safe normalizer; the current combined string does not establish stdout/stderr or trustworthy progress. This is evidence/engineering work under the selected policy, not a request to approve blanket raw disclosure. No additional independently verified safe content subset was found in this review.                                                            |
| SESSION08       | Historical reads/edits/diffs require trustworthy retained revisions/evidence and a selected retention/disclosure contract. Current filesystem bytes cannot be repackaged as what an earlier run read or changed.                                                                                                                                                                                                                                                                                                                               |
| SESSION10/11    | Conditional interactive approvals need request/decision authority, operation identity, expiry/audit and supported provider behavior. Typed prompt references need authorized resource identity/preview and deliberate inclusion boundaries, especially before agent invocation or context/cost expansion.                                                                                                                                                                                                                                      |
| FILE03/DEPT04   | Select supported filesystem/writer coordination, native publication boundary and allowed same/nested department homes. Existing journal/fences preserve uncertainty; restore remains non-durable across filesystem/database failure. Extra database locks alone cannot enforce atomic no-overwrite/source identity against independent Codex/shell writers. No permissive fence release or destructive restore replay is proposed.                                                                                                             |
| CONV01–07       | Metadata-only human group creation exists. Usable chats/topics/threads require membership/invitation/history authority, message/read-state/edit/delete retention, reference/media identity and limits, agent admission/invocation/cancellation, poll identity/results rules and authoritative presence/privacy. Multiple distinct own emoji reactions are already selected; implementing them still depends on the missing authorized message model.                                                                                           |
| SPACE01–04      | Multiple article roots and independent reading order are selected. Implementation still needs article access inheritance, a versioned editable block schema, draft/history/restore authority and media/embed/retention rules. Do not choose public access, an editor/provider or executable embeds by assumption.                                                                                                                                                                                                                              |

No new runtime feature defaults, credentials, live access rules or third-party
integrations are selected here. Pending avatar/status approval remains pending.
Search research stays with the separate cloud task; no duplicate experiment runs.

## Verification and exact files

The missing no-store header was reproduced by an HTTP regression before the fix.
Final verification passed **1,075 tests / 56 suites**, including actual PostgreSQL
role metadata/grant addition and removal observed by the same self caller, all six
successful authorization read headers, selector rejection, exact OpenAPI fields,
zero grants, privileged-route denial and existing 401/503 classification. All
previous Profile, atomic Save, availability, task, session and recovery regressions
remain passing. Lint, typecheck, format, build and `git diff --check` pass.

Regenerated local OpenAPI/inventory/request templates still cover 160 operations
from 24 controllers. Embedded references, placeholder syntax and revision headers
validate; Postman syntax lint reports no issues. No cloud publication or live API
execution was performed. Tests used only isolated `127.0.0.1:55439/profile_test`,
and that database is stopped afterward. This batch adds no migration.

Exact batch files:

- `src/authorization/authorization.controller.ts`
- `src/authorization/authorization.dto.ts`
- `test/authentication-availability.http.spec.ts`
- `test/admin-department.http.spec.ts`
- `Docs/authorization-read-contracts.md`
- `Docs/backend-ui-handoff.md`
- `Docs/api/README.md`
- `Docs/api/openapi.json`
- `Docs/api/endpoints.json`
- `Docs/api/postman-operation-docs.json`

The patch remains uncommitted on `dev` at base `13f4b6f`. Prior dirty Profile,
command-disclosure and publication work is preserved; root README and delegation
assessment retain their recorded hashes. No commit/tag, push, deployment,
production migration, credential creation, default grant or live security setting
was changed. The correction is implementation-ready locally; deployment/frontend
integration and any whole-checklist acceptance remain separate.
