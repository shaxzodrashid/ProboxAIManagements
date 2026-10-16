# Overnight backend gap review — 16 October 2026

Scope: finish the approved atomic human Profile Save, assess additional established
requirements without asking the resting owner, and document registered APIs in the
existing private Postman workspace. No push, deployment, production migration,
agent activation, frontend/Figma or shared Page changes are authorized here.

Sources read: [API checklist](https://chatgpt.com/space/page_86c68f025ae08191bfcddcb21524cfea)
and [Account and Access](https://chatgpt.com/space/page_fadaddb23b508191863a3cd39cc2bc81),
plus current source, contracts and integration tests. The checklist's older prose
is historical: some unchecked umbrellas contain implemented bounded subsets.
Current code/test evidence and subsequent owner decisions take precedence. The
parent owns checklist status; this file changes no shared checkboxes.

## Completed bounded batch

Atomic Save now combines supported names/bio/birthday, supplied audiences and
shared manual availability with stale-draft protection and exact whole-operation
retry/readback. [Contract](atomic-profile-save-contracts.md) documents the additive
routes, migration, all-writer generation, minimal private receipts and compatibility.
This advances API 02/API 12 foundations; it does not close either whole umbrella.
The existing public/shared availability decision supersedes older audience-specific
status proposals. No last-name requirement or legacy-name split was introduced.

## Remaining decisions and existing bounded coverage

| Checklist scope | Verified local coverage / concrete remaining boundary                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 02          | Structured administrative creation and allowlisted self content already exist; atomic Save added. Avatar/custom status and username/phone policy remain outside scope.                                                                                                                                                       |
| API 03          | Avatar storage location, authorized delivery/cache behavior, supported image limits, crop representation and retention require an explicit contract. Existing template MinIO integration does not select these policies for personal avatars.                                                                                |
| API 04/05/08/09 | Preferences, authenticated password change, precise OTP timers and cross-channel model preference synchronization are conditional selections. Do not implement their proposals merely because listed.                                                                                                                        |
| API 06          | Sign-out, access-token versus refresh-token revocation and per-device/account scope are unresolved. No live security changes or session invalidation expansion.                                                                                                                                                              |
| API 07          | Self Telegram link-state read exists. Unlink/relink, identity verification and recovery authority remain unresolved.                                                                                                                                                                                                         |
| API 10          | Calendar-date self edit/clear and independent audience parts are implemented; aggregate Save protects drafts. Other audience defaults remain a product decision.                                                                                                                                                             |
| API 12          | Shared Available/Away/Busy/null is implemented. Custom text limit/validation, symbol representation and expiry remain unspecified; do not invent them overnight.                                                                                                                                                             |
| MAIN 01–03      | Assigned session index, project identity/context, membership markers and durable reauthorized events exist. Discussion/unread/activity feeds depend on missing conversation models. New relevance/ranking and cross-section snapshot guarantees are not selected. Use current read scopes and returned-page counts honestly. |
| ACCESS 01       | Effective permission catalog and current resource checks exist; general denial explanations are not a selected new endpoint. Generated API docs expose actual route permission metadata and retain scope/lifecycle explanations without inferring grants from roles.                                                         |
| ACCESS 02       | Verified ordinary-user helper directory/contact disclosure and request-access workflow remain unspecified. Privileged directory reads do not authorize broader disclosure.                                                                                                                                                   |
| PROJECT 01      | The permitted member-candidate picker exists with current authorization and eligibility checks; see [member picker](project-member-picker-contracts.md). Older unchecked checklist text is not evidence of a missing route. Broader lifecycle/roster policies are not expanded.                                              |
| TASK 02         | Revision-safe status metadata, semantic colors/order, audit and operation receipts exist; [board contract](task-board-status-contracts.md). Shared-board semantics still depend on TASK 07.                                                                                                                                  |
| TASK 03         | Bounded authorized human-task query and priority bands exist; [query evidence](human-task-query-bio-evidence.md). Saved personal views and shared defaults are optional/unselected.                                                                                                                                          |
| TASK 04         | Stable reads, human detail changes, assignees, workflow and deadlines exist with operation receipts; [human collaboration](human-task-collaboration-contracts.md). Cross-project sharing and avatars remain separate dependencies.                                                                                           |
| TASK 05         | Single-assignee checklist definitions, completion, ordering and deadlines exist; [deadline contract](checklist-item-deadline-contracts.md). Do not claim avatar delivery or automatic task completion.                                                                                                                       |
| TASK 06/07      | Typed references, attachment-number scope, attachment lifecycle, sharing authority, board-local versus global status and global completion need selected contracts. Plain comments are not a full rich-reference model.                                                                                                      |
| SESSION 05      | Durable acceptance, run ownership/recovery state and interruption/readback foundations exist; [durability contract](session-durability-contracts.md). Do not automatically replay prompts or equate an accepted interrupt with a confirmed stop. Remaining recovery policy must respect current runner evidence.             |
| SESSION 07/08   | Command/tool output and historical file-diff disclosure need an allowlist, redaction/bounds and trustworthy historical source. Current files cannot substitute for historical bytes. No broad raw event exposure.                                                                                                            |
| SESSION 10/11   | Interactive approval and typed prompt inclusion require identity, exact-operation authorization and resource-reference contracts; existing coding sessions do not establish persistent agent authority.                                                                                                                      |
| FILE 03         | Durable deletion/reconciliation foundation exists; [journal contract](file-deletion-journal-contracts.md). Wider executor containment and restore outcome boundaries remain documented in [options](file-writer-containment-options.md); do not claim OS containment from path checks alone.                                 |
| DEPT 04         | Intentional same/nested homes and compatibility treatment remain policy choices. No universal nested-path ban or path migration is imposed.                                                                                                                                                                                  |
| CONV 01/02      | Only bounded creator-owned group metadata/creation receipts are live. Membership/invitations, history visibility, direct/group/thread lifecycle, message retention/edit/delete and read state are not established. Metadata does not make chat usable.                                                                       |
| CONV 03/04      | Typed references and persistent agent participation need their own verified identities, scope, invocation/cost/cancellation rules and truthful history. Inactive delegated-bio code is not a live API.                                                                                                                       |
| CONV 05/06/07   | Media upload/processing/retention, poll identity/privacy/reveal rules and authoritative presence/last-active/device aggregation remain unresolved. Manual availability does not imply presence.                                                                                                                              |
| SPACE 01–04     | Article access inheritance, hierarchy/reading order, versioned rich-block schema, drafts/history/restore authority, media retention and safe embed policy are unselected. Do not choose an editor/storage/provider or publish articles on the owner's behalf.                                                                |

The safe independent follow-on is contract documentation and source-backed endpoint
inventory, rather than implementing these unresolved security/storage/product choices.
The parent can use the concrete choices above for the morning decision queue.

## Postman boundary

Destination: [ProboxAI Managements](https://go.postman.co/workspace/d69d0c23-a314-4ec5-95fc-3146146fa2f7),
verified visibility personal, team null. Preserve all ten collection IDs, saved
scenario variants, scripts/examples and the existing environment. No public
publishing or visibility change. The installed CLI is 1.74.0; workspace access through
that CLI failed, while the connected Postman tool succeeded. No credential is
requested or written. Environment values are not fetched or changed.

The runtime metadata export contains 160 registered operations across24 controllers,
including the additive Profile Save routes and bounded group metadata. It starts no
application service, database connection, listener, bot or runner. Inactive agent
foundations have no registered routes and are excluded. See the generated
[OpenAPI](api/openapi.json), [inventory](api/endpoints.json) and the Postman handoff
for final readback counts. These describe local implementation, not deployed readiness.

External sync outcome: automatic approval review rejected the first collection
replacement because it could not verify trusted authorization for this exact
workspace mutation/disclosure. Zero collection writes succeeded; readback confirmed
the first collection unchanged. No workaround was attempted. The prepared local
artifacts and exact pending plan remain available in [the API handoff](api/README.md).
