# TASK02 resolved workflow display — October 16

The existing checklist explicitly requires task readers to receive the resolved
status label/color without management rights, consistently across board/card/table
and detail views. The board/status implementation already defines four semantic
colors and palettes. Fresh human task responses exposed only `statusId`, so a
member without board-read grants could not resolve the selected display metadata.
This increment implements that bounded read gap using the existing palette.

## Current read contract

These existing authorized endpoints add `workflowStatus`:

- GET `/api/v1/projects/:projectId/tasks/:taskId`
- GET `/api/v1/projects/:projectId/tasks` (compatibility array)
- GET `/api/v1/projects/:projectId/tasks/query` (`items` only)

It is exactly `{id,name,color,position,palette:{foreground,background}}`, matching
the existing board `BoardStatusResponseDto`. Its ID matches `statusId`. Color
uses only the current NEUTRAL, TEAL, PURPLE and GREEN palette. Names remain plain
text and must be rendered as text. No default, arbitrary CSS, badge/status policy,
new palette or completion meaning is introduced.

Current project membership remains the human read authority, with persisted OPEN
identity/workspace and the existing transaction checks. No task assignment,
`tasks.read`, board-read or management grant is added. Nonmembers/foreign scope
remain unavailable; access is rechecked on each read. The full board/empty-column
roster and edit endpoints retain their existing separate grants. Only the task's
referenced status is projected. Query `statusCounts` remains ID/count only, and
no other board/project/private execution fields are added.

Every response is no-store. Detail/list/query status data is selected in the same
database snapshot as the task. The existing bounded query generation includes the
board revision: a status rename, recolor or reorder invalidates continuation with
409 rather than mixing display generations. New reads resolve current metadata;
human revisions and runner `Task.status` do not change because a status is renamed.
Existing archived-task reads and mutation authority remain unchanged.

## Frozen responses stay frozen

`HumanTaskReadResponseDto` extends the original human-task response only for fresh
reads. Mutation/audit `before` and `after` snapshots retain their original DTO and
shape. They continue to return the original `statusId`, not dynamically refreshed
display metadata. A replay remains byte-equivalent in meaning after later board
renames. Clients must refresh authorized reads for current display values rather
than interpreting historical outcomes as current board configuration.

No old audit is rewritten, inferred, or silently upgraded. The legacy execution
`/tasks` API, saved sessions, priorities, deadlines, assignments and task completion
semantics are unchanged.

## Validation and Unicode compatibility

The shared status projection explicitly allowlists its five fields and derives
the fixed palette; attached relation objects or supplied palette values cannot
leak through it. Invalid stored names, colors or positions fail sanitized 503
`TASK_BOARD_UNAVAILABLE`, without an invented fallback color or raw data.

Independent review found a UTF-16 length mismatch. PostgreSQL's existing status
CHECK uses Unicode character length, while `.length` could reject a valid 61-emoji
name. The shared name validation now counts Unicode code points, preserving up to
120, and the old duplicate UTF-16 board-snapshot check is removed. Service guards
also reject overlong names before writes: validator.js discounts presentation
selectors, which alone can admit strings exceeding the unchanged database bound.
This fixes inconsistent acceptance, not a new limit. Create/rename trim rules,
blank rejection, grants, revisions, atomic audits and all existing colors remain.

## Safety and evidence

No migration, backfill, role grant, history rewrite or production action is needed.
Reverting to the earlier code can reintroduce its Unicode display bug; no schema
or data rewrite is required for this correction.
Tests use only guarded isolated PostgreSQL at `127.0.0.1:55439/profile_test` and
fixture-owned records. README edits and historical migration evidence are preserved.

Coverage includes equal board/detail/list/query projections for zero-permission
members, denied board-management access, all four palettes, rename/recolor without
task-state changes, movement and frozen replay/audit compatibility, query generation
conflicts, membership revocation, mass-assignment denial, OpenAPI read/audit schema
separation and Unicode create/rename/read boundaries. Pure projection tests check
the allowlist and malformed stored metadata. Initial focused verification exposed
an OpenAPI assertion needing Nest's `allOf` representation; that fixture assertion
was corrected. Final focused/cumulative results accompany the delivered checkpoint.
After the corrections, 38 focused checks across three suites passed. A leftover
unused import from the shared extraction was removed before lint/build passed.

TASK02 remains an umbrella for its larger selected experience; this report closes
only resolved per-task display. Avatar delivery, profile status policies, shared
task completion and unrelated backend gaps are not implied. Parent owns checklist
updates and deployment decisions.
