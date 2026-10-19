# Backend changes and UI handoff — 16 October 2026

This is the ongoing UI-impact record for the local backend work. It records
required behavior and integration boundaries; it does not redesign screens or
claim that frontend wiring, Figma updates, runtime accessibility or deployment
is complete. No shared Page or Figma file is edited by this handoff.

**Telegram and first-session plan, 18 October:** the local
[bot interaction batch](telegram-bot-ui-batch.md) adds Menu/Back navigation and
truthful accepted/unknown/stop-state messages without changing auth or execution
semantics. Its before/after examples and tests are recorded there. The
[complete UI-to-session readiness plan](ui-session-readiness-plan.md) starts at
login/current workspace and follows project/task/setup/run/reconnect/completion.
The existing frontend was subsequently located at `D:\Shakhzod\Javascript\ProboxAI_Frontend`.
Its login UI is implemented; live auth remains explicitly gated by the user's
cookie/BFF/session-origin contract, and no authenticated destination exists yet.
Browser/proxy and live provider verification remain explicit gates.
Initial session creation has no client requestId/readback
contract, so the UI must not automatically retry a lost initial response. No
Postman retry, live message, deployment or new session semantics in this batch.

**Current integration inventory, 18 October:** use the
[frontend readiness inventory](frontend-readiness-20261018.md) for the current
172 local operations, tested boundaries and remaining decisions. The 160-operation
Postman snapshot below is historical. Twelve newer routes and subsequent contract
corrections are not fully synchronized there. The later [partial documentation refresh](postman-refresh-20261018.md)
updated40 descriptions, then automatic approval review blocked continuation despite
direct approval. All12 new routes and121 descriptions remain pending. Current local work is not deployed.

**API documentation handoff:** [the local inventory](api/README.md) covers 160
registered operations with schemas, permissions and retry contracts. Following direct
approval, all ten existing personal Postman collections were updated and read back
on 17 October: 161 saved requests cover all 160 operations, with existing scenarios,
tests and saved response payloads preserved. Environment values/access were unchanged.
See [publication evidence](api/postman-publication-result.json). Documentation
publication does not establish deployment, frontend wiring or runtime accessibility.

**Readiness:** implemented backend means local application routes exist and have
test evidence; inactive foundation means domain rules are tested but unavailable
to the UI; planned requirement means confirmed behavior still needs backend work.
Development tags are local checkpoints, not deployed services. Check the target
environment/version before enabling any control.

## Shared manual status

**Affected:** profile overview, status editor, account menu and any task/chat/profile
identity card displaying manual availability. **Backend:** shared manual
availability is implemented; see [contract](shared-manual-status-contracts.md).
The later approved [media/status contract](profile-media-status-contracts.md)
also implements custom text, one Unicode emoji and explicit expiry locally.
Avatar live storage enablement remains deferred.

- One value is shared with everyone: Available, Away or Busy. Remove designs for
  different status values by workspace/department/audience, their priority editor
  and overlap/fallback messaging. Do not request a department roster for status.
- Do not preselect Available or invent Offline. `null` means no manual value is
  set. Preserve an unset/clear state distinct from loading, unavailable and a
  selected value. Account OPEN and a running agent/session never imply online.
- Explain that saving this availability shares it with everyone, including
  anonymous profile viewers. Legacy STATUS privacy records do not hide or vary
  this new value. Keep avatar, bio and birthday privacy editors independent.
- Self read is `GET /users/me/status`; public read is
  `GET /profiles/:accountId/status`. Public output has only account identity and
  the shared availability, without actor history, workspace or last-active time.
- PUT self status requires the current quoted revision in If-Match, one request
  UUID and explicit availability or null. Retain draft and current saved value
  while saving. A successful response acknowledges that request; reread current
  state when reconciling a historical receipt or out-of-order response.
- Missing revision428, validation400 and stale/changed-request409 are distinct.
  Keep the draft on conflict and ask the user to reconcile; do not replay against
  a newer revision silently. After500/503 or lost transport, retain the same
  request ID and original revision, use operation readback or retry unchanged.
  A receipt404 is not a confirmed rollback while the original request may finish.
- Auth failure401, inaccessible/missing profile404, successful unset200 and
  temporary failure503 must not all look like an empty or offline status.
  Recheck on account changes; no push stream or automatic expiry is provided.
- **Main Profile integration:** backend support is now implemented locally in
  [atomic Save contract](atomic-profile-save-contracts.md). Read one baseline with
  GET /users/me/profile/edit. Focused editor Done stages the draft; main Save changes
  sends PUT /users/me/profile/changes with its aggregate expectedRevision, one
  requestId, profile changes, audiences and optional availability. Pre-submit Cancel
  discards unsent changes. Do not send standalone status PUT on Done.
- A successful main Save returns a minimal historical receipt, not current profile
  content. Reread edit state afterward. Preserve the draft on409; reconcile against
  fresh state explicitly. After lost acknowledgment/503 retain the exact command and
  use GET /users/me/profile/operations/:requestId or retry unchanged. Abort after
  dispatch does not prove rollback. Contacts Add/Remove remain separate operations.
- Keep saving, saved, conflict, checking-result and unavailable states distinct,
  with accessible feedback. A historical receipt must not restore old status into
  a newer screen. Disable duplicate submission for UX; server receipts enforce
  idempotency. Aggregate revisions are opaque and may jump by more than one.
- **Frontend/Figma boundary:** no screen wiring, Figma update or runtime
  accessibility verification is completed by this backend batch. A separately
  labelled Save status entry point can still use the compatible standalone API.
- **Later approved custom status:** API writes allow 100 Unicode code points,
  while database/read capacity is 300. Use the server's explicit expiry/active
  state; no automatic expiry default. STATUS audiences govern custom text/emoji
  only. The avatar/status section below supplies current Save and media behavior.

## Employee-linked assistants and approval

**Affected:** assistant creation/settings, permission editor, profile editors,
task actions, message composer, files and any approval dialog.
**Readiness:** confirmed requirements plus an
[inactive bio delegation foundation](delegated-bio-foundation-contracts.md), not
an available approval/delegation API. No live agent principal, credential or
production persistence adapter exists. Do not enable controls by treating a
human JWT, session ID, body agentId or a trusted flag as agent authentication.

| Component                       | Required UI behavior                                                                                                                           | States, edge cases and backend boundary                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistant owner/settings        | Only the employee owner manages this assistant subtype. Show employee ownership separately from the specific acting assistant.                 | Workspace Admin/Owner labels do not grant assistant control. Other future agent types have separate policies. Creation, link, disable and credentials are not live APIs.                                                                                                                |
| Initial permission selection    | Start from a one-time snapshot of the employee's current effective permissions, enabled by default; let the owner adjust them.                 | Later owner gains do not auto-enable agent grants. Effective owner loss removes them permanently; owner regain does not restore them. A permission retained through another role is not a loss. This is modeled in the inactive foundation; real permission writers are not integrated. |
| Content and privacy permissions | Present separate scopes for profile-content editing versus privacy/audience editing.                                                           | Content access never enables privacy or Contacts changes. Granted permission is capability, not an instruction to execute. Do not interpret a combined profile Save as broader delegation.                                                                                              |
| Replace configured work         | Require manual employee-owner approval before an agent overwrites already configured work, including status and another agent's configuration. | Show the affected item/current and proposed value in the future approval flow. Approval must match the intended agent/action/resource/revision. Empty, false, zero or null may be deliberately configured values. Do not silently turn these into permission to overwrite.              |
| Approval outcome                | Distinguish proposed, awaiting owner, approved, rejected, stale, executing, saved and unknown outcome.                                         | These are required UX distinctions, not a selected new wire enum. Approval alone is not a completed edit. An intervening human/agent edit requires fresh review; retries must not duplicate application. No approval endpoint is active yet.                                            |
| Bio/status editor               | Preserve configured values until an authorized replacement commits.                                                                            | The inactive bio model tests exact approval/revision/replay. Shared manual status currently accepts human self actions only; it does not activate agent approval or invocation.                                                                                                         |

No broad autonomous action, automatic approval, credential provisioning, live
agent runtime or new administrative override follows from this handoff. Availability
overlap is no longer a decision; broader history disclosure and SESSION07 command
output disclosure remain separate pending choices.

## Ownership, badges and truthful history

**Affected:** profile/identity summaries, task cards/detail/checklists/comments,
Chat/Thread bubbles, file/attachment attribution, activity and history drawers.
**Readiness:** confirmed requirement; badge clearing and attribution are tested
only in the inactive bio domain. Current live human task/name projections do not
contain an active agent badge/history contract.

- Data/actions belong to the employee and display the employee's public name.
  When performed by an assistant, show a clear AI-performed badge alongside that
  identity. Keep the actual specific actor as a separate fact.
- When the employee overwrites the agent's work, remove the visible AI badge
  from the current item. Do not retain an AI-created badge as a workaround.
  Immutable creation/edit/action history still records who actually acted.
- Failed/rejected approval or write does not change the badge. Late saved
  receipts are historical and must not resurrect an old badge over a newer human
  overwrite, or clear a newer agent badge after an old human replay.
- Do not infer an agent from a Codex session ID, role label, filesystem timestamp
  or pre-existing record. Unknown historical provenance remains unknown.
- Detailed agent history and old private field values need an authorized read
  contract; public badges do not authorize disclosure. No broader history audience
  is selected. Preserve the employee/public name versus owner-private contact
  alias distinction in all identity explanations.

## Mentions, notifications and replies

**Affected:** people picker, mention chips/previews, task comments, Chat/Thread
composer, notification inbox and waiting/reply states. **Readiness:** planned
requirements; no structured mention resolver, durable notification/deduplication
or owner reply-authorization service is implemented by these batches.

- Tagging a linked assistant routes to and notifies its employee owner. Retain
  the selected mention identity without presenting the assistant as an independent
  responsible employee. Selection/mention never grants resource access.
- Deduplicate the source event per employee recipient: repeated tags, employee
  plus assistant, several linked assistants and delivery retries must not create
  duplicate owner notifications.
- A teammate's question addressed to the employee or assistant waits for the
  employee. The assistant cannot answer until that employee specifically asks it
  to in the applicable context. A mention, third-party message/file/tool result
  or copied permission is not that instruction.
- Show waiting-for-owner separately from actual agent execution. An already
  authorized owner task may continue within its scope, but an unrelated question
  cannot expand it. Do not fake unread counts, notifications, delivered replies,
  message streams or group membership while those services are absent.
- Membership/resource revocation must remove sensitive previews and stop later
  deliveries. Agent reads must not clear the human's unread state. Conversation
  admission, rejoin/history policy and broader notification delivery still need
  their own backend contracts.

## Other completed backend work affecting current designs

These rows include the task/project work completed today and the related local
backend contracts needed to consume it accurately. They do not assert a finished
frontend or add new product policies.

| Screen/component                                     | Implemented backend and required UI behavior                                                                                                                                   | Errors, edge cases and remaining work                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add project member picker                            | Authorized current-workspace OPEN-account search/filter/sort/paging, public names and existing-member flags. Use member-candidates without broadly requiring users.read.       | Preserve off-page choices; loaded results are not the full roster. Selection grants nothing; assignment rechecks current eligibility. No foreign roster/private bio/phone/alias. [Contract](project-member-picker-contracts.md).                                                                                                                |
| Board columns, task cards/table/detail               | Stable workflow status with current label, semantic color and resolved palette; status management is a separate capability.                                                    | Color supplements the visible label. Human workflow is separate from runner status; runner success does not automatically mean Done. Occupied status removal needs explicit moves, permissions and revisions. [Contract](task-workflow-display-contracts.md).                                                                                   |
| Task/checklist assignee avatars and compact identity | Fresh task reads include public identities keyed by assignee ID. Reuse the same lookup for checklist assignee IDs, with public name disclosure on hover/focus/touch.           | Missing/inactive/foreign identity hydration does not erase retained IDs or history. Use a neutral initials fallback; avatar assets remain absent. Names may refresh without changing task ordering. Private contact aliases do not replace public names. [Contract](task-assignee-identity-contracts.md).                                       |
| Priority, Board and Table queries                    | One bounded authorized filtered scope, multi-key ordering, scoped totals/group counts and generation-aware cursors. Explicit-time deadlines sort before date-only, then unset. | Separate loaded cards from total. A changed generation409 requires replacement from page one, not silent append. Do not turn date-only into midnight or infer counts from a partial page. Saved views and frontend wiring are separate. [Query evidence](human-task-query-bio-evidence.md), [deadline order](exact-deadline-sort-contracts.md). |
| Task/checklist editing                               | Human revisions, exact request retry, multiple task assignees, one checklist assignee, individual deadlines and stable whole-list order.                                       | Only the assigned employee completes its checklist item; completion does not complete the task. Preserve drafts on conflict; use authorized readback after an uncertain save. Typed attachments/references and shared-board completion rules remain unfinished. [Contract](human-task-collaboration-contracts.md).                              |
| New task dialog                                      | Optional creation request UUID supports reconciliation after a lost response without duplicate creation. Retain it until the outcome is known.                                 | Create-only users can read their receipt without task-read grants. Do not generate a new ID after unknown outcome, infer board linkage or auto-start execution. [Contract](task-creation-recovery-contracts.md).                                                                                                                                |
| Task title/description form                          | Human edit now preserves existing creation limits: title240 and description16000, with matching Unicode validation semantics.                                                  | Existing valid long tasks must round-trip; preserve validation drafts. Checklist title200 and execution criteria8000 remain separate. HTTP body-size limits also apply. [Contract](task-text-limit-contracts.md).                                                                                                                               |
| Project Sessions list and Home session links         | Project-filtered session query rechecks membership/assigned-manager scope and returns current task identity/title.                                                             | Global/task-only summaries keep their prior shapes. No complete run history, liveness or active total follows from latest-per-task data. Labels are current per page; missing context is unavailable. [Filter](project-session-query-contracts.md), [identity](project-session-task-identity-contracts.md).                                     |
| Contacts/privacy selector                            | Directed Contacts removal and private aliases stay owner-scoped; relationship changes affect later authorized reads.                                                           | Do not retain cached private values after revocation. Status simplification changes neither bio/birthday/avatar audiences nor permission boundaries. [Contract](profile-picker-contracts.md).                                                                                                                                                   |

## Handoff discipline

### Fresh authorization context — 18 October

`GET /authorization/me` keeps `{id,workspaceId,roles:[{id,key,name}],permissions}`
and now documents those required fields explicitly. All authorization GETs send
no-store on success. Self accepts no query filters/selectors and still works with
zero permissions. After known access changes, reload and replace the prior context;
distinguish verified empty grants from 401, 403, 503 and loading. Keep resource
membership, ownership and lifecycle checks separate from a granted key.

Current source has 37 permission keys; the historical 27-key Access design cannot
claim complete coverage until its descriptions include later additions. No helper
directory or can-perform-action endpoint was added. [Contract and remaining decision
queue](authorization-read-contracts.md) record the exact bounded support and the
older unchecked items already substantially implemented. Local API artifacts were
refreshed; deployment, frontend/Figma wiring and external Postman publication were
not performed. The approved media/status increment below supersedes the earlier
pending feature state.

### Profile lookup and remaining gaps — 18 October

Self GET/PATCH `/users/me` and both public profile lookups reject all unsupported
query parameters with 400. Pass no owner, workspace, viewer or includePrivate
selector. Exact stored UUID identity wins; alternate casing resolves only one
unambiguous account and its existing audiences. The shared-availability lookup
uses the same resolver. Ambiguous/inactive identities
remain 404 and responses keep stored identity. This
batch changes no field shape, Save receipt, revision or availability behavior.

The [verified Profile gap review](profile-gap-review-20261018.md) lists exact fields
and remaining decisions. Names, bio, date-only birthday, audience evaluation,
atomic main Save and shared manual availability are implemented locally. The later
approved media/status increment below supersedes the earlier missing-feature
assessment. Backend verification is not frontend,
Figma or deployed readiness. Local API artifacts were refreshed; cloud Postman
publication was not repeated. Existing Done-stage/main-Save wiring remains required.

### Approved avatar and custom status — 18 October

Use the [current media/status contract](profile-media-status-contracts.md). Root
`GET /users/me/profile/edit` returns `customStatus` (including `active`) and current
`avatar` metadata alongside the baseline revision. Basic `/users/me` is unchanged.
Root Save accepts optional `customStatus` and `avatarAssetId`: omission retains,
null clears. Status objects supply nullable text, emoji and expiresAt together.
API text writes accept 100 Unicode code points; storage/read capacity is 300.
Preserve an untouched longer stored value by omitting the status field, rather than
truncating it. No expiry is imposed by default. STATUS audiences govern custom
text/emoji; Available/Away/Busy remains shared and independent.

Stage JPEG/PNG via multipart `POST /users/me/avatar-uploads` with one retained UUID
requestId and optional complete oriented square crop. Done keeps that staged asset;
one main Profile Save publishes its assetId with other changes and audiences.
Pre-submit Cancel sends no Save; an unused ready stage may be explicitly discarded.
The staging deadline never expires a published photo. Removal uses null in main
Save. UPLOADING means uncertain: read the original operation and preserve its ID;
never declare failure or issue a new upload identity just because acknowledgment
was lost. Missing uncertain uploads can remain fenced for later reconciliation.

Use authenticated fetch and a local blob URL for restricted image routes; do not
put bearer credentials in query strings. AVATAR audiences and current reference
are rechecked on delivery. Clear old cached UI values after revocation and use
initials when metadata is null/unavailable. Physical cleanup is eventual and cannot
recall already delivered bytes. The private storage bucket must be preprovisioned
and explicitly configured before runtime media use. No deployment or frontend
wiring has been verified by this local implementation.

Avatar outage handling: a failed metadata/ownership dependency read is 503, not a
verified missing image or a logout signal. Preserve the current draft and upload
request identity for reconciliation. An authoritative missing or hidden image is 404. A failed final access check suppresses bytes already fetched from storage.
See the contract's existing-storage inspection for exact environment requirements;
the general health-ready endpoint does not verify the avatar bucket.

### Shared-task association foundation — 18 October

The owner approved explicit sharing by an authorized task owner, canonical human
completion across projects and independent local workflow columns. The
[shared-task contract](shared-human-task-contracts.md) records the independently
implemented association slice and later creator-only confirmation. Do not treat
this as a complete cross-project task-card API; content/history visibility and
reopening remain unselected.

The original owner reads `/projects/:projectId/tasks/:taskId/sharing` and retains
its aggregate human revision. Only currently accessible destination identities are
returned; an omitted destination is not proof no hidden association exists. An
explicit selected destination and same-board status can be added/removed with
`tasks.create`, original ownership and current membership in both projects.
Writes require a retained UUID request identity and quoted If-Match revision.
Reconcile uncertainty through the actor-bound sharing-operation route rather than
generating another ID or automatically rebasing a stale draft. Sharing does not
grant membership, transfer ownership, reassign staff or switch execution context.

An assigned destination member with `tasks.workflow.move` can change only the
additional board's column using `/shared-workflow-status`. A green/Done column,
runner success or checklist completion never changes canonical human completion.
The original board retains its existing workflow API. Move occupied shared entries
explicitly before deleting their column; no bulk cross-project audit disclosure is
introduced. A project with shared associations cannot be purged as context-free.

The migration retains null for unknown historical canonical completion and creates
no inferred shares. One-way creator confirmation is implemented below; reopening
and destination human-content/comment/audit disclosure remain pending. Keep those
unselected UI controls inactive;
existing destination task list/query/detail endpoints do not yet surface shares.
`GET /projects/:projectId/tasks/:taskId/shared-state` is available to a current
member for a known original/shared association. It returns only taskId, the route
projectId, local statusId, aggregate revision and the same canonical completed/null.
It exposes no task text or another project's metadata. Null means no recorded
canonical decision. Revocation/unsharing returns unavailable on later reads.
There is no frontend, deployed or whole-checklist acceptance claim here.

The current OPEN task creator with `tasks.details.manage` and original-project
membership can POST `/projects/:projectId/tasks/:taskId/completion/confirm` with
requestId and quoted human If-Match revision. No completed/owner/actor selectors
are accepted. Confirmation is manual and one-way: assignees move columns but do
not confirm final completion, and no column move reopens a confirmed task. A new
confirmation on an already confirmed task conflicts; exact authorized replay
returns its saved acknowledgment without changing attribution/time. Preserve the
request ID after an uncertain response and use sharing-operation readback.

An owner-linked-agent-created task belongs to the represented employee creator.
Manual confirmation records that employee while retaining actual-agent origin
history separately. No agent task-creation/credential adapter or autonomous final
approval is activated. Mirror copy/edit/deletion propagation is still a proposal;
the [contract constraints](shared-human-task-contracts.md#constraints-for-the-mirror-reflections-proposal)
must shape it.

### Readiness and managed catalog — 18 October

Public readiness errors now return the existing unavailable envelope with a generic
message, not raw connection/storage errors. Liveness is independent; green ready
checks PostgreSQL and template storage and does not establish avatar/runner/feature
readiness. Use HTTP status and retry state rather than interpreting it as a logout.

Session model-catalog OpenAPI now describes the nested version/providers/models and
per-model effort arrays. Keep the existing sessions.create gate. Offer only the
selected model's returned supportedReasoningEfforts and its supplied default;
the vocabulary enum is not a universal capability list or live provider-availability
assertion. See the [exact contract](readiness-catalog-contracts.md).

### Initialization, extension and webhook contracts — 18 October

Read initialization lists/details using the new complete attempt-plus-steps schema.
Retry201 contains attempt scalars only: do not replace known step history with an
invented empty array, infer completion or blindly retry after an unknown outcome.
Follow detail/events for current state. Cancellation200 is only `{cancelled:true}`;
never label descendants confirmed stopped or staging quarantined from that response.
Operational paths/lease metadata retain their existing gated scope and are not
client-selected paths or proof of live process ownership.

Protected-extension list/add/update return scalar records; preserve original
createdById across updates and normalized duplicate append. Input remains a
leading-dot extension, trimmed/case-normalized, at most64 characters. Removal
acknowledges a rule, not file-byte deletion; a second absent removal is404. Existing
owner/sensitive-access gates remain authoritative.

Telegram webhook success has an empty200 body, including ignored updates. Do not
parse a JSON acknowledgment or equate that transport response with completed
message dispatch/delivery. See the [exact contracts and verification](persisted-response-contracts.md).

### Provisional command details — 17 October

REST session history and SSE now share a version 3 command projection with exact
generic allowlisted labels and validated terminal item exit codes. The existing
assigned-manager/workspace/permission checks still apply. Output text, dynamic
commands, shell wrappers, cwd and raw archives remain omitted. Render omission
explicitly, distinguish null exit codes from zero, and use server session state
for run completion. The policy is provisional and revisitable; SESSION07 remains
partial and frontend wiring is unverified. See the [full contract](session-command-disclosure-contracts.md).
The published Postman snapshot predates this additive local schema.

Keep this record current when a backend batch changes a visible control, identity,
permission, save outcome or recovery path. Record actual readiness and link its
contract. Surface unsupported features honestly instead of making a static design
look live. Verify keyboard/touch equivalents, focus, loading and status messages
in the eventual frontend; backend tests alone do not establish accessibility.

### Telegram model panel and transport proposals — 18 October

The Telegram provider-first wizard is replaced locally with direct model choices
in one editable panel, supported reasoning/defaults, eight-model pages and explicit
Confirm/Cancel. Until Confirm, selections are drafts; project/session selection and
running work are unchanged. Confirmation compares original model settings before
writing and cannot launch a task. Old/expired/foreign buttons cannot save. Drafts
last ten minutes in process memory; restart/another replica requires reopening.
See [Telegram behavior and test evidence](telegram-bot-ui-batch.md). No live bot
messages or deployment are claimed.

[Browser-session/BFF](browser-session-bff-proposal.md) and
[initial-create receipts](initial-session-create-receipt-proposal.md) remain
review-only. Their new storage, cookie/CSRF, revocation, namespace, receipt-read and
retention choices require owner agreement before implementation. Postman approval
does not approve these proposals. Existing frontend live-auth and initial-create
retry restrictions remain in force.
