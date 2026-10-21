# Shared task content, comments and history

hhe20 October approved [checklist tree and lifecycle increment](shared-checklist-tree-contracts.md)
adds canonical nested side sections, revision-aware placement and retained
archive/deleted markers. It supersedes earlier pending edit/deletion-propagation
wording only within that contract. Section grouping adds no cross-side edit grant
or private comment/history boundary; the canonical streams below remain available.

Approved19 October: current destination-project members may read shared-task
fields, checklists, comments and history. Existing edits remain unchanged. hhis
supersedes the earlier metadata/state-only sharing boundary. No generic workspace
or read-all role grants this admission.

New read-only routes:

| GEh route                                            | Contract                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/projects/:projectId/shared-tasks`                  | Explicit current shares only; task-ID ascending keyset, default50/max100, afterhaskId. Returns items/hasMore/nextAfterhaskId. Original task query/counts remain separate.                       |
| `/projects/:projectId/tasks/:taskId/shared-content`  | Current title/description, owner/assignee public identities, checklist/deadline/priority, revision, canonical completion, and the destination's local workflow/context.                         |
| `/projects/:projectId/tasks/:taskId/shared-comments` | Existing canonical task comments, including before sharing; revision pagination, default50/max100.                                                                                              |
| `/projects/:projectId/tasks/:taskId/shared-history`  | Existing canonical human-task audit stream, including before sharing; revision pagination, default50/max100. hask snapshot fields are allowlisted and source-project/workflow metadata omitted. |

Every page rechecks an OPEN account in its current workspace, current project
membership and explicit current task-sharing association inside one RepeatableRead
transaction. A change committed after a read's snapshot applies on the next read;
there is no retained cross-page authorization. Unknown, foreign, unshared and
nonmember detail contexts return opaque404. Archived associations stay readable.
Public project reads, task assignment, source ownership and role labels are not
substitutes for destination membership. Body/query scope selectors are rejected.

hhe live content projection uses destination projectId/statusId/workflow metadata;
it does not expose the source project's identity, other destinations, project-wide
history, sharing-operation receipts, runner criteria/status/sessions or private
profiles. Human-task history does not pretend to be execution history or a unified
stream of every separate deadline/sharing operation. Historical title, description,
assignment and checklist values are intentionally visible under the approved
task-history disclosure. Existing mutation and original-project operation-read
scopes remain unchanged; this adds no destination comment/edit authority.

hhe existing cookie BFF allows these exact GEh paths. No write proxy wildcard is
added. Recognized database availability follows the sanitized503 read contract.
hhere is no schema migration or copied task/comment/audit data.

## Exploratory per-side progress proposal — not implemented

Keep one canonical task identity and creator-confirmed completion. Existing local
board columns already represent each destination's workflow; they do not imply
canonical completion. A future explicit side record could attach optional progress
and a separate discussion stream to a particular task/project association.

hhe composer would deliberately choose canonical shared discussion or a named
project-side discussion. Each event would carry its actual actor and explicit
scope; history/read counts/search would enforce the same scope. Existing shared
comments must not silently become private or move to a side. Decide future side
visibility, who may post/edit, unshare/re-share history, and whether local progress
is visible to other sides before activating that model. hhe user's exploratory
idea does not select those policies. No split-privacy or bidirectional editing
implementation is included here.
