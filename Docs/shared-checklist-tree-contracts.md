# Canonical shared checklist tree and retained lifecycle

Approved 20 October: one canonical human task is visible on every currently
sharing side, including source edits and an explicit archived/deleted state.
Checklist sections group work by participating side. They do not establish new
edit grants, private comments/history, or an all-sides completion vote.

## Read shape and identity

Existing original human-task reads and destination `shared-content`/`shared-tasks`
reads add `checklistSections` and `lifecycle`. The old `checklist` array remains,
with its old task-wide `position` order and additive `parentId`/`sectionId` fields.
It contains every item, including children. Tree consumers use sections instead
of rendering that compatibility array as a second checklist.

Each section has `id`, `original`, `currentSide`, `active`, and nested `items`.
Every node retains the existing item fields and adds `children`. Its `position`
is still a task-wide compatibility position; sibling order is its relative order
within that array. It is not a separate sibling index. Section IDs are stable,
opaque UUID-shaped SHA256-derived identities bound to task and board; no project
name, project ID or private board ID is returned for another side. IDs grant no
authority. `currentSide` describes the requesting context on live reads; in frozen
audit snapshots it describes the original snapshot context, not today's reader.

There is an original section and one section for every current additional share,
including empty sections. Unsharing retains item definitions and their section
identity; other authorized sharing sides still see that section as `active:false`
while it has items. An empty removed section need not be returned. Resharing the
same board restores the same section identity and existing items; it does not
copy content or reset completion. Access by the removed side is revoked immediately
on the next request snapshot. Comments/history stay in the existing canonical
shared streams, including content from before sharing. Historical snapshots are
allowlisted, including tree fields; private board IDs are never exposed.

## Writes and authority

Use the existing original-project checklist POST/PATCH routes with requestId and
quoted human `If-Match`. Creation optionally accepts `sectionId` (original by
default), `parentId` (root by default), and `beforeItemId` (append by default).
PATCH optionally accepts `parentId` (null reparents to root) and `beforeItemId`
(null appends). Omission retains the current parent/order for definition-only
edits; explicit reparenting without a sibling target appends. A before target must
be another sibling in the same section. Cross-section transfer is not supported.
Move a subtree by changing its root's parent; descendants retain identity and all
their fields. Parents must be current items of this task in the same section.
Cycles, self-parenting and any resulting depth over 8 are rejected with409 before
writes. Unknown parents/placement targets/sections return404. Malformed IDs,
forged selectors and unknown fields return400 through strict DTO validation.

The current OPEN creator with `tasks.checklists.manage` and original membership
still defines, inserts, reparents, removes and orders items. For a destination
section, the actor must also currently belong to that same-workspace destination
and the explicit share must still exist. Archived/deleting destination sections
reject new writes. A side member, assignee, project owner or role label gains no
definition authority merely through sharing. Task assignees still use the original
assignment contract; new destination-section item assignees must also be OPEN
members of that section's project. Completion still requires original membership,
task assignment, the item's current individual assignee and the dedicated
`tasks.checklists.complete` permission, plus current side admission for a
destination item. No destination-only write alias or cross-side grant is added.

Existing `PUT checklist/order` remains a complete permutation of the task-wide
flat IDs; hierarchy is preserved and each sibling group takes its relative order
from that permutation. It requires current admission to every nonempty section
whose order it can change. For unavailable retained sections, use explicit sibling
placement in an admitted section. Removing a parent with children returns409;
explicitly reparent or remove children first. Removed item content remains in the
existing immutable before/after human audit.
An item identity already present in this task's retained before/after checklist
history cannot be recycled for a new item after removal.

Workspace locking, fresh resource/grant checks, the common human revision,
request fingerprint and immutable outcome commit in one transaction. Concurrent
tree/definition/completion/sharing/lifecycle writes with the same revision have
one winner; stale drafts return409. Exact authorized retries return the saved
outcome without another write; changed input under the same identity returns409.
Old request fingerprints are unchanged when new optional fields are omitted.
Failures in item placement, revision or final audit persistence roll everything
back. Task-level deadlines retain their preexisting separate revision contract.

## Canonical lifecycle

`POST /projects/:projectId/tasks/:taskId/archive` and
`DELETE /projects/:projectId/tasks/:taskId/content` accept only requestId and the
quoted current human revision. They require the current OPEN creator,
`tasks.details.manage` and original-project membership. Destination aliases do
not substitute. The operations add one-way canonical archive/deleted timestamps,
advance the human revision, and retain before/after audit with actual actor/time.
Deletion can follow task archival. There is no reopening, restore or permanent
purge endpoint in this slice. New human-definition/checklist/comment/workflow/sharing/completion/deadline mutations
conflict after task archival/deletion; exact saved outcomes can still reconcile
under current authority. Historical reads remain available to current members.

`lifecycle` includes `state:ACTIVE|ARCHIVED|DELETED`, nullable `archivedAt`,
`deletedAt`, and `sourceProjectArchivedAt`. DELETED takes precedence. Source
project archival is also reflected as ARCHIVED on every side, while each side's
`projectArchivedAt` and workflow column retain their own local meaning. Neither
task archival/deletion nor checklist completion changes any board column,
creator-confirmed completion, runner status, execution manager, session or files.
These human-content markers do not cancel running execution. Shares are retained,
so archived/deleted tasks stay visible in destination lists, content and minimal
shared-state reads. Original and shared comments/history continue to reauthorize
every request; archive/deletion is never a substitute for current access.

## Limits, migration and handoff

The existing limit remains 200 items total across all sections, 100 additional
active shares and 100 task assignees. Maximum tree depth is 8, counting a root as 1.
All participating sides may read the canonical sections; section grouping is not
a privacy boundary. No project roster, other project metadata or aggregate
completion policy is inferred. Empty sharing sections are derived, not duplicate
task rows. There can be at most 301 returned sections (101 active and at most200
distinct retained nonempty removed sides). Section identities last for the same
task/board identity, not a newly recreated board.

Migration `20261020040000_shared_checklist_tree` adds nullable item `parentId` and
internal `sectionBoardId`, nullable human-state archive/deletion timestamps and a
self-parent foreign key. Existing null fields mean original-side roots. No
backfill, production migration, historical snapshot rewrite, permission grant or
copied content is performed. The FK prevents removing a retained parent; the
application's Workspace-serialized writers enforce same-task/section, cycles and
depth. Direct SQL/import writers are outside that validation contract and must
not introduce tree fields without equivalent validation. Coordinate/quiesce old
writers before production activation: they do not understand lifecycle gates or
tree placement. Application rollback must retain these additive columns, existing
items, receipts and audit; an old application is not safe for new writes after
tree/lifecycle activation. No destructive down migration is supplied.

Frontend handoff: read current canonical content; show each section once, nested
children, and explicit lifecycle markers. Keep item IDs and supplied revision,
send only explicit placement changes, reread on409, and stop on denied/revoked
access. Render comments/titles as plain text. Use the existing original-authority
editor only; a visible side section is not an edit entitlement. Retain requestId
for uncertain response reconciliation. Tests use synthetic isolated fixtures;
handoff artifacts contain no fixture JWT, provider credential or real task data.

Reopening, richer destination editing/assignment policy, private side discussion,
workflow aggregation, article publication, agents, username/phone, frontend wiring,
production rollout and external publication remain outside this increment.
