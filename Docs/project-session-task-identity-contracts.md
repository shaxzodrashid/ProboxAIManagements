# MAIN01 project session task identity — 16 October 2026

Available since local `0.3.0-dev.4`. MAIN01 in the authoritative API Feature Gaps
page (`page_86c68f025ae08191bfcddcb21524cfea`, sequence81, reread16 October)
selects safe task/project identity for the project Sessions index. The existing
explicit task-board project filter already proves current project membership,
which independently authorizes the narrow human task title. This batch adds that
task identity subset, without a project-name or action-capability policy.

## Contract

GET `/api/v1/sessions?projectId=<UUIDv4>` adds required-per-returned-item `task`
containing exactly `{id,title,projectId}`. Its ID equals the item's existing
`taskId`; `projectId` is the canonical explicit board association checked by the
query, not the session's saved execution project. Title is the current persisted
task title, without guessing a label, interpreting rich text or executing markup.

Global queries and queries containing only `taskId` keep their original exact
six item fields: `id,taskId,status,stopConfirmation,createdAt,updatedAt`. They do
not expose `task`, including when the task happens to have a board link. OpenAPI
therefore declares an optional `SessionListTaskContextDto` on the common item
schema, with explicit project-filter-only semantics. Filter validation and the
outer `{items,hasMore,nextCursor,asOf}` envelope remain unchanged.

No project name, description, execution criteria, prompt, path, saved execution
context, creator, profile, runner data or capability is included. Project name
authority cannot be inferred from session permission alone; richer project
metadata remains a separately scoped contract. No count/liveness or ability to
launch work is established by a row or title. Responses remain `no-store` and
perform no runner action or filesystem inspection.

## Scope, paging and failure

Every page keeps the existing persisted OPEN account/workspace, sessions.read,
assigned execution manager, task/session workspace, explicit board/project and
current project membership checks. Human task assignment, task creator, public
project access or read-all/manage-all grants cannot bypass those checks.
No tasks.read grant is newly required: the already verified member-only human
task contract authorizes this narrow title in the project-filtered scope.
Unknown, foreign, nonmember, unassigned or unlinked scope stays uniformly empty.
Archived history remains readable under those same current checks.

The page's task IDs/titles are batch-selected once, in the same RepeatableRead
transaction, from at most100 returned session items. Only requested page IDs and
the current workspace are selected; existing session filtering established their
project/membership/assignment authority in that same snapshot. There is no
per-session lookup and no hydration for an empty or nonproject page. Missing
required task context or dependency failure rejects the page with the existing
sanitized503 `SESSION_LIST_UNAVAILABLE`, rather than returning fabricated labels
or silently dropping authorized rows.

CreatedAt/id ordering, cursor scopes, creation cutoff and limit/lookahead remain
unchanged. Current names may change between pages without invalidating cursors;
`asOf` is a creation cutoff, not a frozen task-name snapshot. Task rename does not
rewrite the session, change its saved execution context or imply activity.
Each continuation still rechecks membership/assignment/board/workspace scope, so
revoked rows and their titles disappear. A matching saved execution project/cwd
cannot substitute for the explicit task-board relationship.

## Evidence and safety

Five new guarded isolated HTTP/Prisma cases cover exact title/identity projection
without task-read grants, canonical project ID, unchanged global/task-only fields,
different tasks in one project, unassigned-title exclusion, rename between pages,
unchanged session persistence and sanitized dependency/missing-context failures.
Existing project-session tests continue to cover revoked membership, assignment,
all three workspace boundaries, association removal, broad-grant denial, archives,
execution-context mismatch, old cursor compatibility and OpenAPI validation. The
project item allowlist and optional nested schema assertions are updated explicitly.

No migration, data backfill, permission/grant/default change, external integration
or production action is introduced. Existing README edits, the separately
uncommitted linked-agent assessment and migration evidence remain preserved.
MAIN01 stays partial for wider Home feeds, complete counts and richer authorized
project/capability summaries. Final cumulative checks and independent review
accompany the local checkpoint; no push or deployment is implied by its tag.
