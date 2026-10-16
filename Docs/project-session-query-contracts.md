# MAIN01 explicit project-task session query — October 16

This local increment adds a project filter to the already bounded assigned-session
index. The existing one-board-per-project `TaskBoardEntry` relationship and current
member human-task read rule provide the source contract. It creates no new task
association, permission grant, membership policy or execution behavior.

## Request and response

`GET /api/v1/sessions?projectId=<UUIDv4>` narrows sessions to tasks explicitly linked
to that project's board. It intersects existing `taskId` and `statuses` filters;
omitting it preserves the original global assigned-session behavior. UUID casing
is canonicalized at the service boundary. Repeated/invalid values and unknown
query keys reject with 400. `selectedProjectId` is not an alternate query key.

The existing response is unchanged: `{items,hasMore,nextCursor,asOf}`, with each
item containing only `id,taskId,status,stopConfirmation,createdAt,updatedAt`.
The requested project is a filter, not newly exposed project metadata. The
response includes no project name, roster, filesystem path, execution context,
task title/description, prompt, provider data, private profile or capability flag.
There is no total/complete-active-count or process-liveness claim. Responses are
`Cache-Control: no-store`; reads never start, resume or interrupt work.

## Authorization and association

Every page rechecks persisted OPEN identity, current workspace and `sessions.read`
inside the same RepeatableRead transaction as rows and database-clock cutoff.
Session and task workspace must both match, and `Task.managerId` must be the
caller. A filtered task's explicit board must belong to the requested same-workspace
project, with the caller still a current project member. Project membership,
human assignees, task creator, role labels, `tasks.read-all`, `projects.read-all`
and `projects.manage-all` cannot replace the assigned execution manager or the
session-read grant. Broad project grants do not bypass the member rule, matching
the existing human collaboration read contract.

Unknown, foreign, nonmember, unlinked and unassigned project/task combinations all
produce the same successful empty scoped page, without existence labels/counts.
Missing authentication/grants still fail under the existing 401/403 contract;
database failures retain sanitized 503 `SESSION_LIST_UNAVAILABLE` behavior.
Archived project history remains readable under current membership. Readiness
does not grant execution, and read results never imply that a new run is allowed.
Detail/history/action endpoints continue to authorize independently.

A session's saved `selectedProjectId` and cwd describe execution context, not its
task's collaboration board. They are neither used to infer board membership nor
rewritten. A session saved with another execution project still belongs in this
filtered task history when its task has the explicit requested board link. A
session with only a matching cwd/saved execution project is excluded if its task
is unlinked or belongs to another board. Legacy tasks remain unlinked.

## Paging and changes

The existing limit 1..100 (default100), createdAt/id descending order, bounded
lookahead and creation cutoff remain. Project-filtered cursors additionally bind
the canonical requested project. Project/global cursors and different project,
task, status or caller scopes are not interchangeable. Existing unfiltered cursor
hashes remain unchanged, so the additive filter does not invalidate them.

Each continuation re-evaluates membership, assignment, task-board association,
workspace and status. Revocation removes affected rows from subsequent reads.
`asOf` remains a creation cutoff, not a retained snapshot or complete run history
across changes. Older sessions can appear alongside a newer session for the same
task; this is not a latest-session-per-task summary.

## Safety, evidence and remaining gaps

No schema migration, backfill, identity rewrite or new integration is required.
Verification uses only the guarded isolated `127.0.0.1:55439/profile_test` database,
with a controlled runner and no provider or production actions. Existing migration
evidence and unrelated README edits are preserved.

New HTTP/database cases cover explicit links versus execution context, older runs,
filter intersections, current membership/assignment/workspace revocation,
nonmember broad grants, zero-permission/authentication denial, unknown scope,
canonical cursor binding, legacy unfiltered cursor compatibility, archived reads,
input validation, exact response projection and generated OpenAPI. Existing index,
detail, replay, directory-context and authorization regressions remain applicable.
Final cumulative results accompany the delivered checkpoint.

Focused verification passed 25 existing/new HTTP cases before the final
board-association-removal regression was added. An initial fixture-only TypeScript
error was corrected by checking that its default status exists. Independent
read-only review found no actionable source/authorization/cursor issue. Full lint
and the application build passed; the actual precommit gate verifies the final
fixture and cumulative suite before a local checkpoint is accepted.

MAIN01 remains partial: discussion/unread/activity feeds, broader Home composition,
project identity/capability summaries and complete cross-section counts are not
implemented here. This filter supplies a bounded authorized task-history query,
not a complete project runtime inventory. No status/avatar/availability policy,
shared-task semantics, retry of work or stop-acknowledgement policy is selected.
