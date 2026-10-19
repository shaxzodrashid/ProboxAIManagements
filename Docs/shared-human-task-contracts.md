# Explicit shared tasks and canonical human completion

The owner approved explicit sharing by an authorized task owner, one canonical
completion state across projects and independent board-local workflow columns
(owner reply Sentinel_111d92ca82a48191a4c4c549fff2e069). This remains local work;
no push, deployment, production migration, credentials or new role grants.

Current local status: creator-only one-way completion confirmation is implemented
and verified alongside sharing/local-state foundations. Reopening and broader
mirror content/history/edit/removal propagation remain undecided. Earlier pending
confirmation wording below is superseded by the later owner decision and current
creator-only contract, not a reason to block independent backend work.

## Existing boundaries and additive foundations

`Task.creatorId` is the human owner; `Task.managerId`, runner `Task.status`,
sessions and execution context remain independent. Existing task links remain
the original board association. Additional shares use a separate table rather
than transferring the original link or duplicating task content.

Canonical human completion belongs to the existing task human state, with
nullable completed/by/at fields. Null preserves the absence of historical human
completion evidence. Neither a column called Done nor a successful runner event
backfills completion. Board-local workflow and canonical completion never update
each other automatically.

The additive migration creates initially empty additional-board associations and
private operation receipts, without inferred sharing, completion or permission
grants. Composite foreign keys constrain statuses to their own board; a database
scope check requires an existing original human link and same-workspace projects.
The same task ID and aggregate human revision coordinate concurrent changes.

## Essential boundaries pending clarification

**Later owner decision:** assignees may advance workflow; only the creator confirms
canonical completion. The one-way confirmation increment below supersedes the
confirmation-authority question in this earlier section. Reopening remains
unselected, as does broader destination content/comment/audit disclosure.

Existing owner edits require `tasks.details.manage`; existing column moves require
`tasks.workflow.move` and assignment. Neither rule previously defined canonical
completion. The current clarification asks whether canonical completion is owner
only, assignee only, or both, under the corresponding existing permissions.

Destination project membership must not disclose another project's names, boards,
roster, counts, execution criteria or session data. The other clarification asks
whether sharing exposes only the existing human task fields, retaining comments
and audits in the original project, or also exposes that historical content.
No read or mutation that depends on these unanswered choices is activated merely
by creating the schema foundations.

Avatar storage stays blocked while the user is away. No reminder, credential
request, provisioning or live storage operation is part of this task.

## Independently implemented association and local workflow slice

The original project's task owner can explicitly add/remove a destination board,
using existing `tasks.create` plus current membership in both same-workspace
projects. A label, read-all grant, project creator identity or execution manager
never replaces ownership/membership. No role default or permission assignment is
changed. At most 100 additional board associations are accepted per task.

Destination-column moves reuse existing `tasks.workflow.move`, current destination
membership and current task assignment. They affect only that additional board.
The existing original-board workflow endpoint and permissions remain unchanged.
Owner edits/assignee/checklist/deadline/comment contracts are not broadened.

Routes relative to `/api/v1`:

| Route                                                                  | Contract                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /projects/:projectId/tasks/:taskId/shared-state`                  | Current member plus original/explicit association; only taskId, route projectId, local statusId, revision and canonical completed/null. No other project or human-content metadata. |
| `GET /projects/:projectId/tasks/:taskId/sharing`                       | Original owner edit snapshot, aggregate human revision, only currently accessible destination IDs/status IDs; no hidden total.                                                      |
| `PUT /projects/:projectId/tasks/:taskId/shares/:targetProjectId`       | Original owner, `tasks.create`, membership in both projects; requestId plus explicit destination statusId.                                                                          |
| `DELETE /projects/:projectId/tasks/:taskId/shares/:targetProjectId`    | Same owner/scope; requestId; retires only the selected association.                                                                                                                 |
| `PUT /projects/:projectId/tasks/:taskId/shared-workflow-status`        | Destination project context, current assignee plus move permission; requestId/statusId.                                                                                             |
| `GET /projects/:projectId/tasks/:taskId/sharing-operations/:requestId` | Actor-bound immutable acknowledgment after fresh action authority; not current state.                                                                                               |

All writes use quoted `If-Match` human revision, UUID request identity, allowlisted
bodies, empty query DTOs and workspace serialization shared with existing writers.
Fresh owner/assignment/membership/permission checks precede replay. Exact matching
retries return the original acknowledgment without reapplying an old association
or column; changed reuse and stale drafts conflict. Request IDs have a sharing
namespace separate from existing human-action receipts. Common human revisions
still serialize both namespaces. Receipts expose minimal route-context IDs rather
than copying another project's task/audit snapshot or execution content.

New writes reject archived/deleting route/destination contexts. Authorized matching
receipt replay remains available after archive. Removing a share does not transfer
the original link, remove assignment, reset completion, remove another share or
change runner/session state. Missing membership cannot be overridden to revoke a
share through an inaccessible project. That requires restoring authorized scope
or a separately selected recovery authority, not implicit manage-all bypass.

An occupied shared column must be moved explicitly before column removal; the
older bulk-removal path cannot write a cross-project task snapshot into original
human history. Project deletion's context check now includes additional board
associations and blocks before filesystem lifecycle changes. No auto-unlink or
cross-project cascade policy is added.

This is intentionally partial: existing destination task list/query/detail routes
do not expose newly associated task content, and no canonical completion write
endpoint is active before the pending authority/disclosure answers arrive. The
frontend must not treat association receipts as a complete shared-task card API.
Old board columns and runner success are not canonical completion evidence.

The minimal shared-state route already reads the same canonical completion record
through every authorized association, while returning that board's own status ID.
It accepts zero-permission current members under the established human-read rule;
public-project flags, read-all labels and forged viewer selectors do not substitute
for membership. Revocation or unsharing removes later access. This route does not
expose completion attribution, task text, assignees or historical content while
their broader destination projection remains undecided.

## Exact files in this increment

```text
prisma/schema.prisma
prisma/migrations/20261018020000_shared_human_tasks/migration.sql
src/tasks/shared-tasks.dto.ts
src/tasks/shared-tasks.service.ts
src/tasks/shared-tasks.controller.ts
src/tasks/tasks.module.ts
src/tasks/task-boards.service.ts
src/projects/projects.service.ts
src/openapi/api-docs.ts
test/shared-tasks.http.spec.ts
Docs/shared-human-task-contracts.md
Docs/human-task-collaboration-contracts.md
Docs/task-board-status-contracts.md
Docs/backend-ui-handoff.md
Docs/api/README.md
Docs/api/openapi.json
Docs/api/endpoints.json
Docs/api/postman-operation-docs.json
```

Migration safety: nullable canonical fields and initially empty share/receipt tables;
no inferred historical completion, original-link replacement, content backfill,
new permission or grant. DDL is transactional and requires an ordinary lock window.
An older binary may leave additions in place, but cutover must quiesce old board
and project deletion writers because they do not know about additional associations.
No down migration or destructive rollback is supplied. Retain receipt/state tables
when rolling back application code until shared associations are reconciled.

## Verification and acceptance boundary

Final frozen-source verification: **1,143 tests / 61 suites passed**, including
all 15 new sharing cases and existing authorization, task, board, project deletion,
archive, profile, session and persistence regressions. This supersedes intermediate
runs, including a run started before the final read route was added. No runtime
source changed during the final successful full run.

The focused task/board/project run passed 269 tests before the final minimal-state
read addition. A fresh final-source sharing run passed all 15 HTTP/PostgreSQL
cases, including owner/key/membership/workspace boundaries, status ownership,
canonical-state consistency with different local columns, stale concurrent drafts,
receipt replay without resurrection, final-receipt rollback, archive behavior,
membership revocation, data minimization and database scope/attribution constraints.
No live runner or external object storage is used.

Typecheck, lint, format, build and release checks pass. All 34 migrations are applied
only to `127.0.0.1:55439/profile_test`. Prisma validation and schema parity pass
(empty migrate-diff script). Local API export and request-template checks cover
171 operations across 27 controllers; OpenAPI syntax lint reports no issues.

The feature remains partial until canonical completion-write authority and broader
destination task-content/history disclosure are answered. No whole TASK07 checkbox
is changed or claimed closed. Frontend wiring, deployment and production migrations
remain unverified/on hold. Unrelated Profile, authorization, session and user dirty
work is preserved; protected README and delegation-assessment hashes are unchanged.

## Creator-only canonical confirmation

The owner selected: "Assignees can move them further, only owner(creator) can
confirm it is done." The subsequent owner-linked-agent clarification preserves
the employee as task creator/owner while actual-agent creation attribution remains
separate. Neither decision authorizes autonomous agent confirmation or reopening.

`POST /projects/:projectId/tasks/:taskId/completion/confirm` accepts only requestId
and the existing quoted human If-Match revision. It requires a current OPEN human
`Task.creatorId`, `tasks.details.manage` and original-project membership. Project
ownership, role names, assignment, execution management and copied agent grants do
not substitute. No sharing permission or membership in every destination is needed
for this existing original-owner definition scope. Calling through a destination
alias cannot bypass original-project authority.

The command sets canonical completed=true with employee attribution/time and
advances the human revision in the same transaction as its minimal private receipt.
Exact authorized retry/readback retains the first actor/time. Another new request
for an already confirmed task conflicts. Stale concurrent confirmations have one
winner; final-receipt failure rolls state/attribution/revision back together.
Fresh owner/permission/membership checks precede replay; archived/deleting source
projects reject new writes while authorized historical replay remains available.

No request can set completed=false or supply a replacement owner/actor. Assignee
column moves remain available under their existing permission/assignment rules and
never confirm or reopen global completion, even when moved back to an earlier
column. Confirmation neither completes checklists, changes a board column nor
stops/changes runner sessions. No checklist/runner prerequisites or completion
freeze on other existing operations are invented.

The current runtime has no live linked-agent task-creation/credential adapter.
An existing trusted agent-origin task must retain the represented employee in
Task.creatorId and actual-agent origin in immutable creation history separately.
Tests model that preexisting origin using the existing human audit table, then
verify manual employee confirmation leaves the whole origin row unchanged. They
do not establish a new agent creation API. Agent JWT principals and direct agent
contexts cannot use this human confirmation route.

This increment reuses the prior additive completion/receipt schema; no additional
migration, permission key or role grant is needed. Remaining boundaries are
reopening authority, destination task-content/history visibility and the broader
mirror edit/removal/propagation contract. The whole shared-task umbrella remains
partial; selected confirmation work is no longer blocked on those other choices.

## Constraints for the mirror-reflections proposal

- One task ID, employee creator and canonical completion record; an additional
  board association is not another task or another completion decision.
- Each board owns its own local column. Labels/colors and assignee moves never
  confirm or reopen global completion.
- Preserve the original execution manager, sessions and saved execution context;
  adding a mirror cannot redirect running work or expose execution contents.
- Sharing grants no membership or permissions. Recheck the current workspace,
  membership, owner/assignment and existing permission for every operation.
- Current additional-board reads expose only minimal canonical/local state.
  Other project identities/counts, human content, comments and historical audit
  snapshots are not automatically visible through a reflection.
- Current definition, checklist, deadline, assignment and comment writers retain
  their existing scopes. Bidirectional edits and field propagation need their
  own selected rules; reflection terminology alone does not authorize them.
- Removing a selected association preserves the task, canonical state, staff and
  other boards. Shared associations block context-free project purge. No mirror
  deletion cascade or hidden-project cleanup authority is selected.
- Preserve actual-agent creation history separately from employee ownership and
  later manual actions. Ownership is not proof of agent execution/overwrite approval.
- Use the common human revision and retained request identity; old receipts must
  never resurrect removed associations or overwrite a newer local column.

### Current creator-confirmation verification

Final frozen-source regression: **1,169 tests / 63 suites passed**, including27
sharing/confirmation HTTP/PostgreSQL cases. The focused task/action/board run
passed214 tests across three suites before the final untyped-agent-context denial
assertion; the final full run includes that assertion. Coverage includes human
creator authority, represented employee ownership with preserved immutable actual
agent origin, rejected autonomous/ambiguous agent contexts, original membership,
existing permission loss, one-way input, concurrent confirmation, exact replay,
attribution retention, final-receipt rollback and independent assignee movement.

Typecheck, lint, format, build, release and diff checks pass. The local OpenAPI and
request templates cover172 operations/27 controllers and pass reference/body/syntax
verification. All34 existing migrations remain valid in isolated PostgreSQL; this
confirmation increment requires no additional migration or grant. No live agent
creation adapter, runner execution, storage change, cloud publication, deployment,
production migration or push is introduced.
