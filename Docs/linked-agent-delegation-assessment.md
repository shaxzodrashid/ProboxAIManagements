# Linked-agent delegation assessment — 16 October 2026

Assessment only. No agent identity, credential, grant, delegation, availability,
presence, schema or runtime implementation is introduced. The tested runtime
checkpoint is dev `344505d` / `v0.3.0-dev.7`, with an inactive delegated-bio domain
foundation, no production adapters or live delegation. This report records the new
owner direction relayed by the parent task on16 October, superseding the earlier
self-only availability suggestion and the subsequent audience-valued status
proposal; neither is the current status contract. No proposed default is approved.

## Selected requirements

- Only an employee's linked agents may act on that employee's behalf. Linking
  does not confer blanket rights or remove explicit agent permissions.
- On creation the agent receives a snapshot of all its employee owner's current
  permissions, enabled by default; the owner can adjust agent grants afterward.
  Owner permission loss automatically removes that permission from the agent.
  New owner gains never automatically expand an existing agent's grants; explicit
  owner addition is required. This is neither an empty-grant default nor a
  continuously expanding mirror. It does not authorize credential minting or a
  runtime launch in this assessment.
- Actions must distinguish an actual human actor from a specific AI agent.
- Employee-linked agents are owner-controlled assistants, not independently
  deciding teammates. Only their employee owner manages them. Permission
  possession is separate from execution authority, including after the default
  full permission snapshot. These subtype rules do not cancel other prospective
  platform agent types or already authorized work from the owner.
- Mentions/tags addressed to a linked assistant in tasks, Chats or Threads resolve
  to its employee owner and notify that employee. Questions from other teammates
  addressed to either the employee or assistant wait for the employee. The
  assistant cannot answer until the employee specifically asks it to. A third-
  party message, mention, file or tool output is never owner authorization.
- Agents may manage profile information, send messages/files and interact in
  Chats, Threads and Task Manager on behalf of their employee. Resulting data
  belongs to the employee and displays the employee's name with a visible
  AI-performed badge while the current work is attributed to the agent. When an
  employee overwrites the agent's work, remove the visible AI badge from the
  current item. Do not retain a creation badge after that overwrite. Immutable
  creation and edit/action history still records the actual actors truthfully.
- Agents cannot replace or overwrite already configured things without manual
  approval from their employee owner. This applies beyond status, to existing
  configuration/content across action families, including another agent's work.
  Copied permissions or a general capability are not replacement approval.
- Profile-content editing and privacy/audience editing have separate permission
  scopes. Granting one does not grant the other; the existing combined human Save
  is not authority for an agent to change privacy or Contacts.
- The owner subsequently simplified status: "There will be single standalone
  status for everyone!" There is one shared manual status value, the same for
  every viewer. No audience-specific values, rule priority, overlap resolution,
  group resolution or viewer fallback is required for status. This supersedes
  the prior Busy-for-IT/Available-for-Marketing examples. Existing Available,
  Away and Busy design choices remain the basis without a selected default.
  Connection presence and the independent privacy permissions/audiences of other
  profile fields remain separate. Existing STATUS disclosure-policy metadata
  must not suggest that it controls this new universally shared availability.
- Work remains local: no push, deployment, production migration or live security
  changes. Always-on runtime provisioning is not implemented by this assessment.

Earlier Available/Away/Busy wording comes from the profile design/requirements
table in `page_fadaddb23b508191863a3cd39cc2bc81`; API12 in the gap checklist owns
manual availability/custom status. Uppercase wire enums and a nullable self-only
first step were engineering proposals, not approved backend contracts. That
interim step would have tested persistence while deferring audience delivery, but
has little standalone user value and is now superseded. No such code was added.

## Confirmed answers to the five questions

The original owner answers relayed on16 October settled questions2–5. The later
single-standalone-status decision supersedes question1 rather than choosing an
overlap algorithm. SESSION07 command/output disclosure is still unanswered.

| Question                       | Confirmed decision                                                                                                        | Implementation consequence                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Conflicting audience values | Superseded by the later owner decision: one standalone status shared with everyone.                                       | No audience-specific status rules, overlap priority or viewer fallback.                                                                                       |
| 2. Overwriting configured work | Agents need manual owner approval before replacing or overwriting already configured things; this is broader than status. | Preserve existing configured values. A stale approval or copied permission cannot silently authorize a different replacement.                                 |
| 3. Audience meaning            | Both workspace and employee-group audiences are supported concepts; Marketing and IT are departments/groups of employees. | The group meaning remains settled, but status no longer depends on any employee roster or audience evaluation.                                                |
| 4. Content versus privacy      | Separate edit permissions, affirmed.                                                                                      | Profile-content authority cannot edit visibility/audiences or Contacts. Any selected relationship/privacy action needs its own scope and execution authority. |
| 5. Human overwrite badge       | Employee overwrite removes the current item's visible AI badge.                                                           | Keep truthful immutable actor history, but never retain the visible creation badge as a substitute for the owner's decision.                                  |

Detailed approval binding, revision checks and receipts below are proposed
engineering mechanisms for enforcing these decisions, not additional owner
answers or permission to mint credentials.

## Verified current source

| Surface               | Current fields and behavior                                                                                                                                                                                                                                                                                                                                               | Required compatible extension                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication        | `src/auth/auth.types.ts` has only `AuthenticatedUser`/human access payloads. `auth.guards.ts` looks up OPEN User and fresh role permissions. No Agent, employee-agent link or scoped agent credential model exists. Codex session/process/thread identity is execution data.                                                                                              | Add a distinct authenticated principal and independently revocable agent credential/link scope. Resolve employee subject server-side. Never borrow a human JWT or treat body/query employeeId, sessionId or tool output as delegation.                                                                                                      |
| Profile               | `accounts.dto.ts` allowlists firstName/lastName/bio/birthDate; `accounts.service.ts` writes the authenticated OPEN account. `profile-privacy.controller.ts` derives owner from the human actor. No durable profile mutation receipt/audit or profile-wide revision exists; structured names have compare-and-update protection and atomic privacy Save uses Serializable. | Keep subject/employee separate from actual actor. Use one coordinated revision/receipt/audit path for human and delegated writes; keep existing field/security allowlists. Adding an agent-only writer while human routes bypass its concurrency/audit rules is insufficient.                                                               |
| Audiences             | `profile-audience.ts` returns a boolean using Everyone, directed Contacts or Custom union of account IDs/current workspace membership. `ProfileAudiencePolicy` is unique by owner/field. Legacy STATUS remains policy metadata; shared ManualProfileStatus now provides a separate public manual-availability value.                                                      | Preserve boolean disclosure for other fields. New shared manual availability has one public value and does not consult legacy STATUS policy records. No audience-valued status model is selected.                                                                                                                                           |
| Teams                 | User belongs to one workspace. Departments scope project/template storage. There is no employee-to-department membership relation.                                                                                                                                                                                                                                        | Marketing/IT now explicitly mean departments/groups of employees; workspace audiences also remain valid. Any independently selected employee-group feature needs a deliberate roster/management contract; shared status does not. Do not infer staff membership from project/template paths, project participation or workspace membership. |
| Tasks/checklists      | `Task.creatorId` is the human task owner, `managerId` is the separate execution manager; `TaskAssignee.userId`, checklist `assigneeId` and `completedById` use employee IDs. Reads expose owner/assignee IDs and current public names.                                                                                                                                    | Retain employee ownership/assignment/completion semantics; add trusted actual actor provenance for creation and subsequent changes. Do not replace creator/assignee with agent IDs or bypass employee/resource action rules.                                                                                                                |
| Task comments/history | `TaskComment.authorId` is a User; human/board/deadline audits have one `actorId`. Mutation receipts freeze before/after and replay. Comment DTO, task read DTO and audit DTO carry no actor-kind/agent/badge metadata.                                                                                                                                                    | Keep employee author/owner and record actual creator/editor separately. Extend fresh reads and newly versioned receipts/audits deliberately; preserve old frozen payloads and exact retry behavior. Add scoped actor attribution to comment lists, details, completion/history and future activity streams.                                 |
| Group metadata        | `ChatGroup` has employee creatorId/ownerId and a frozen creation receipt. It is a bounded create/creator-read foundation only.                                                                                                                                                                                                                                            | Preserve employee ownership and add actual actor attribution to new creations/edits and receipts when delegated authority exists. Group management does not imply message/admission authority.                                                                                                                                              |
| Chats/Threads/media   | No durable human DM/message/topic/thread/attachment service is implemented by the current group metadata foundation.                                                                                                                                                                                                                                                      | Design new records with employee author/owner plus actual actor provenance from the start. Apply each room/topic/project membership and visibility rule; filesystem/project access does not authorize a chat attachment or post.                                                                                                            |
| Project files         | File listing/upload DTOs expose path/name/type/size/timestamps, not employee ownership or upload creator. Upload writes the filesystem. Trash has deletedById; deletion journals have actorId.                                                                                                                                                                            | Employee-owned message attachments need durable asset/reference/provenance records. Deliberately extend project-file mutation journals/readback if delegated project-file actions are enabled. Do not infer uploader/actor from filesystem timestamps, paths or external writers. Existing FILE03 containment/recovery limitations remain.  |

No persisted employee-linked assistant subtype, structured mention resolver,
owner reply-authorization receipt or notification deduplication contract exists.
`NotificationDelivery` is schema-only, not a durable mention/unread service. The
new owner-only management, mention routing and reply gate therefore require new
contracts; copied permission keys do not implement those rules.

Source anchors: `prisma/schema.prisma`, `src/tasks/human-task-state.ts`,
`human-tasks.dto.ts`, `human-task-actions.service.ts`, `task-boards.dto.ts`,
`task-deadlines.dto.ts`, `src/groups/groups.dto.ts`,
`src/projects/projects.dto.ts` and `projects.service.ts`.
`Docs/persistent-platform-agent-gaps.md` remains the broader historical agent
architecture record; the owner-linked delegation requirements here are newer.

## Bounded implementation sequence proposed

1. **Principal and delegation boundary.** Introduce stable agent identity and
   revocable credentials, employee link, narrowly granted actions/resources and
   lifecycle. Keep distinct actual principal, employee subject and delegation
   identity in internal context. Recheck credential, link, agent grants,
   employee eligibility and resource checks when committing and when queued work
   begins. Employee association must come from trusted persisted delegation.
   Disabling a link/credential or revoking permission must block subsequent work.
   Existing human grants/roles must not change as a side effect. Atomically copy
   the effective union of owner permissions at agent creation; do not clone role
   labels or grant rights the owner lacks. Coordinate every owner permission
   writer with downward removal of corresponding agent grants. A grant surviving
   through another owner role is not an effective permission loss. Mere request-
   time intersection is insufficient: loss followed by owner regain must not
   silently resurrect the removed agent permission. Persist that removal, or an
   equally authoritative revocation history, before any later agent action can
   run. Check the effective current intersection and individual delegation/resource
   scope on each action. Later owner gains and newly introduced permission keys
   require explicit additions to existing agents, subject to current owner rights.
   For this owner-controlled assistant subtype, even an effective permission is
   only capability: execution also requires an applicable owner instruction.
   Owner-only management and other resource rules remain mandatory regardless of
   copied permission keys. Other platform agent subtypes keep separate policies.
2. **Shared provenance and mutation protocol.** Proposed conceptual fields are
   employee owner/author ID, actual actor kind plus human/agent ID, delegation ID,
   stable request ID, operation, revision and before/after. Technical field names
   are not selected API contracts. Store immutable creation provenance and
   per-edit/action attribution, with tombstoned identity references if needed.
   Scope idempotency to actual actor, subject, operation/resource and input.
   Existing records/receipts keep their known shape; do not invent an agent badge
   or reconstruct historical actors without evidence.
   For delegated execution, also persist the trusted owner instruction identity
   and its applicable operation/resource/reply context. Do not take an
   ownerAuthorized flag or a copied/forwarded teammate message as proof.
   Replacement of any existing configured value additionally requires explicit
   manual owner approval. Proposed enforcement: bind approval to actual agent,
   employee subject, resource/operation, exact proposed replacement and observed
   revision; verify and consume it atomically with the mutation/receipt. A
   conflicting human or agent write invalidates that replacement rather than
   silently rebasing approval. Identical request replay returns the saved outcome
   without executing or consuming approval twice. Clearing, deleting/recreating
   or whole-object replacement cannot bypass the same check. False, zero, empty
   strings and explicit null may be configured values; do not use truthiness to
   classify them as unconfigured. Failed or rejected writes change neither badge
   nor attribution. Current human overwrite clears the visible badge; original
   creation and subsequent actual-actor history remain immutable. Do not backfill
   invented agent provenance into legacy records or frozen receipts.
3. **First delegated vertical slice.** After decisions, start with an explicitly
   permitted existing profile field or task action, not all profile/settings or
   an entire always-on runtime. Reuse all field limits, audience/resource checks
   and coordinated human-writer revision rules. Scope profile-content capability
   separately from privacy/audience capability; reject a combined delegated Save
   containing unauthorized privacy changes atomically rather than dropping fields.
   Contacts remains a distinct relationship action. Add actor-aware readback/history
   and server-derived AI badge. Cover forged employee/actor IDs, unlinked or other
   employee agents, two agents, human conflicts, revocation and uncertain retry.
4. **Shared manual availability.** Independently add one shared status value,
   without an invented default or audience-specific rule. No status overlap or
   employee-group resolution is required. Apply
   manual owner approval before agents replace existing configuration. Return
   the same current value to every viewer without private profile or actor history.
   Require current eligible account reads. Automatic connection presence remains a separate
   contract and cannot be falsified by an agent or availability selection.
5. **Additional action families.** Apply the same trusted context/provenance to
   task comments/checklists/status changes and then selected Chats/Threads/media
   contracts. Employee ownership/name and actual-agent badge are distinct facts.
   Preserve immutable attribution when the human or another authorized agent
   later edits a record; human overwrite removes the current visible AI badge.
   Existing configured values still require manual owner approval for an agent
   replacement. No provider spend or agent invocation follows merely from receiving
   a message, mention, badge, file or reaction.
6. **Owner routing and explicit reply gate.** Resolve structured assistant mentions
   from authoritative subtype/link records to the employee recipient within the
   currently authorized task/room/topic context. Deduplicate at the source event
   and employee-recipient level, including repeated tags, owner-plus-assistant
   tags, several assistants of one owner and delivery retries. Preserve original
   reference identity without exposing inaccessible employee/agent records. A
   question for either employee or assistant produces employee notification and
   a waiting state; it is not an agent job. Only an authenticated instruction from
   that employee, bound to the intended reply/action context, can authorize the
   reply. Recheck link, effective grants, instruction scope and recipient/resource
   access before queued execution or delivery. Existing owner-authorized tasks
   may continue within their actual scope; unrelated teammate questions cannot
   expand that authorization. Acceptance must include duplicate notification
   suppression, owner-only management, forged/third-party instructions, agent
   permissions without execution authority, reply retries and revocation.

The later `Docs/delegated-bio-foundation-contracts.md` records the inactive domain
foundation now implemented; it does not activate any stage above end to end.
No checklist closure is assigned by this assessment.
API02/API12 and the existing agent/CONV/TASK/FILE dependencies remain partial or
open. Parent owns any new cross-cutting checklist IDs.

## Safe next bounded implementation plan

The settled decisions permit a coherent **owner-approved delegated bio edit**
vertical slice. Bio already has a selected plain-text limit1000 and private
default. This slice does not need audience-valued availability, a staff roster,
messages, avatars, filesystem operations or SESSION07 output disclosure.

This is a plan, not an implemented endpoint/schema or a credential provisioning
operation. Keep profile-content capabilities independent of privacy capabilities.
Use proposed technical names only when writing the implementation contract.

1. Establish persisted employee-agent identity/link and owner-only management,
   actual-principal/employee-subject separation, revocable action grants and an
   owner-instruction record. Copy the owner's effective permissions once;
   coordinate all human permission writers with durable downward removal and
   verify no resurrection after owner regain. Test with isolated principals and
   fixtures; do not mint live credentials, borrow human JWTs or run a provider.
2. Add a shared revision/receipt/immutable actor-history protocol for the selected
   bio field. Coordinate every existing human bio writer, including PATCH self
   and combined Save, with that protocol. Keep other human field contracts and
   frozen historical receipts compatible. Owner-only history/readback for this
   initial slice is a proposed conservative boundary; any broader history audience
   needs an explicit contract. Store only the selected field and required actor/
   approval evidence, with no private audience rosters or unrelated credentials.
3. Let the authenticated employee approve an exact bio replacement for one linked
   agent at the observed revision. Execution rechecks current link/grants,
   applicable instruction, approval and resource scope, then commits bio, approval
   use, revision, actual-agent attribution and receipt atomically. A proposed or
   denied approval is not a successful edit. Preserve existing content until
   the authorized replacement commits; first-time population must still have an
   applicable owner instruction. No rule precedence is needed for this field.
4. Expose the agent badge only through the existing authorized current projection.
   A subsequent employee overwrite removes that badge while preserving truthful
   creation/edit actors in immutable history. Approval or inspection alone does
   not change content or the badge. Replay/late responses cannot resurrect an old
   badge over a newer human revision; old receipts remain historical outcomes.
5. Keep privacy/audience and Contacts writes outside this slice. Content-only
   agents must fail on forged privacy/contact selectors and combined content-plus-
   privacy attempts. Leave the employee's existing audience policies intact;
   public bio delivery continues to use the existing viewer authorization.

Required verification: real HTTP and isolated database tests for forged subject/
actor selectors, another owner's agent, missing/manual/denied/stale approval,
two-agent and human-write races, transactional rollback, exact uncertain retry,
all human bio writer paths, immediate link/grant revocation, owner loss/regain
without grant resurrection, content-versus-privacy denial, private/public reads,
agent badge then human overwrite clearing it, and retained actor history. This
scope is independent of availability. The owner has since removed audience-valued
status rules; no overlap question remains for status. A fixture or
pure decision function alone does not complete the vertical slice or CONV04.

## Precise remaining boundaries

- **Status audience overlap/fallback is superseded, not pending.** One shared
  value is the same for everyone. Do not build audience-specific status rules or
  consult department membership to resolve it. No selected value means unset,
  not Available, Offline or a viewer-specific fallback.
- **Employee-group membership is not a status prerequisite.** Marketing/IT mean
  departments/groups of employees, and the source still has no staff roster.
  Any independently selected future employee-group audience feature needs its
  own membership-management/visibility contract; do not infer roster authority
  from storage Department permissions or add it to this status batch.
- **Manual replacement approval is required, not a timed override proposal.**
  Exact approval binding/revision/replay mechanisms above are engineering work.
  No blanket approval, expiry policy, silent overwrite, automatic reapproval or
  general autonomous execution is inferred. Ambiguous owner instructions must not
  be treated as exact replacement approval.
- **Profile-content and privacy permissions are separate, answered.** Exact
  capability names are engineering choices. Contacts remains a separate
  relationship action; no automatic privacy/contact grant follows from content
  delegation. Credentials, roles, permissions, lifecycle, workspace membership
  and authentication recovery remain excluded from profile-content delegation.
- **Current badge clearing is answered.** Human overwrite removes the visible AI
  badge; immutable actor history remains truthful. Broader access to detailed
  agent identity/history and private old values needs an explicit audience
  contract before exposing such history beyond its authorized owner. Do not use
  that narrower history question to keep a creation badge visible.
- **SESSION07 disclosure remains separately pending:** the five answers do not
  choose sensitive command/output rendering with best-effort redaction versus
  strict exclusion and omitted unclassifiable text. No SESSION07 change follows
  from this assessment.

Token format, database column spelling and DTO casing are engineering choices,
not additional product questions. Agent ownership transfer, group admission,
provider budgets and runtime recovery remain separate existing unresolved
contracts; they need not be silently implemented by the first profile/task
delegation slice.

## Verification status

Current source was inspected directly at dev `344505d` / `v0.3.0-dev.7`;
authentication still resolves only OPEN User and Department has no employee
membership roster. Independent read-only review of this decision update found
no actionable findings; document formatting and whitespace checks passed. No
runtime tests are claimed as proof of agent behavior. The unchanged runtime
checkpoint passed990 tests in54 suites, including31 inactive-domain tests; those
tests do not establish live agent delegation. This assessment remains separately
uncommitted and README stays untouched. The new shared-manual-availability
implementation and its verification are recorded separately. No live credential,
provider launch, push, deployment or production migration is performed.
