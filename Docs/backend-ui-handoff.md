# Backend changes and UI handoff — 16 October 2026

This is the ongoing UI-impact record for the local backend work. It records
required behavior and integration boundaries; it does not redesign screens or
claim that frontend wiring, Figma updates, runtime accessibility or deployment
is complete. No shared Page or Figma file is edited by this handoff.

**Readiness:** implemented backend means local application routes exist and have
test evidence; inactive foundation means domain rules are tested but unavailable
to the UI; planned requirement means confirmed behavior still needs backend work.
Development tags are local checkpoints, not deployed services. Check the target
environment/version before enabling any control.

## Shared manual status

**Affected:** profile overview, status editor, account menu and any task/chat/profile
identity card displaying manual availability. **Backend:** shared manual
availability is implemented in the current local batch; see
[contract](shared-manual-status-contracts.md). Custom status text and avatar-corner
symbol delivery remain unfinished.

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
- **Still undecided:** custom text validation/limit, icon/emoji representation,
  symbol validation and expiry behavior. Do not hardcode new limits, defaults or
  an expiry timer. Avatar upload/crop/delivery is separately unfinished.

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

Keep this record current when a backend batch changes a visible control, identity,
permission, save outcome or recovery path. Record actual readiness and link its
contract. Surface unsupported features honestly instead of making a static design
look live. Verify keyboard/touch equivalents, focus, loading and status messages
in the eventual frontend; backend tests alone do not establish accessibility.
