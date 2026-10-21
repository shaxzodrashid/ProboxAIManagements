# MAIN01 assigned-session index

The subsequent [project-task query increment](project-session-query-contracts.md)
adds `projectId` through the explicit task-board relationship, with current
membership and the same assigned-session read authority. References below to
project queries being absent describe the original October 12 checkpoint.

Local implementation, 12 October 2026. This delivers a complete bounded session-index endpoint using the already established session-detail read authority. It closes the missing global/assigned-task session-list capability, including older sessions hidden by latest-per-task summaries. MAIN01 remains partial because project-task boards, discussion feeds and broader Home composition are separate dependencies. No task/project association, active-count aggregation, presence or stop-containment policy is introduced.

## Endpoint and response

`GET /api/v1/sessions` requires current OPEN account and sessions.read. Cache-Control is no-store. Query fields:

- statuses: optional explicit SessionStatus values, comma-separated or repeated. QUEUED, RUNNING, PAUSED, COMPLETED, FAILED, INTERRUPTED, ARCHIVED. Empty, duplicate or unsupported values return 400. Omit for all statuses; no inferred Active category.
- taskId: optional UUIDv4 assigned-task filter. Unknown, foreign or unassigned task filters return the same empty scoped list.
- projectId: optional UUIDv4 explicit task-board project filter; current same-workspace project membership is required. Intersects taskId/statuses. Unknown/inaccessible projects return the same empty scope. See the subsequent contract above.
- limit: canonical decimal integer 1–100, default 100.
- cursor: optional opaque continuation, maximum 2048 characters. Treat it as opaque; it is pagination input, never an access credential.

Unknown query fields return 400. The later project filter uses the implemented
TASK02/04 relationship; a session's cwd or saved execution context is never
converted into task-board membership. `selectedProjectId` is not a supported filter.

```text
{
  items: [{id, taskId, status, stopConfirmation, createdAt, updatedAt}],
  hasMore: boolean,
  nextCursor: string|null,
  asOf: UTC date-time
}
```

items is bounded to limit. Only these six fields are selected/returned: no task title/description, prompt, turns, cwd, model/provider, catalog, thread/process/owner/lease identifiers, project data, account grants, logs or archives. Item IDs are the stable session and task identities. Status is persisted state, not current process liveness. STOP_UNCONFIRMED remains uncertainty and cannot enable a recovery action. Unknown legacy stop flags become NOT_OBSERVED without changing storage. updatedAt is database modification time, including event/lease updates; it must not be presented as user activity, last-online or a full activity history.

## Scope, paging and freshness

Each page repeats current OPEN/id/workspace/sessions.read in the same RepeatableRead transaction as its database clock and rows. Both session.workspaceId and task.workspaceId must match the caller, and task.managerId must be the caller. tasks.read-all, projects.read-all and projects.manage-all do not bypass assignment. The captured permission array, session creator identity or project membership cannot widen this scope. All returned rows satisfy the existing session-detail read rule at that snapshot; detail/history/actions still reauthorize independently.

Order is createdAt DESC, id DESC, using an immutable creation key and deterministic tie-breaker. The cursor retains the database-clock creation cutoff and last item's creation/id key. It is bound to caller/current workspace, normalized status set and task filter. Changing limit is permitted; reusing a cursor with a different caller or filter returns 400. Cursor fields are untrusted and validated; fresh authorization and the row predicates enforce scope even if a caller constructs their own cursor. The context hash is not a signature, a secret or permission to access an anchor ID. Cursor continuation uses key values rather than requiring the anchor row to still exist.

asOf is a creation-time cutoff, not a retained snapshot, commit boundary or expiry. Newly created later sessions are excluded from continuation; restart without cursor for a fresh listing. An older-started transaction committing later can still introduce rows created before the cutoff. Each page reevaluates mutable status, assignment, deletion and account/grants: rows may enter/leave the requested filter between pages, and already-returned state may become stale. A status change in an already-consumed order range needs a fresh listing. There is no promise that concatenated pages are one atomic complete current-active set. This behavior is deliberate and visible in the contract; no shared snapshot/as-of aggregation is claimed.

hasMore means an extra currently authorized matching row was found at that page's snapshot. It is not a total count or capability token. No complete active/session count is returned. Repeat the same cursor to reconcile a lost page response; if status/membership changed, the result can differ. Client transport cancellation initiates no runner or mutation; an already issued database read may finish without its HTTP response being received.

## Failures and boundaries

Missing/expired auth or non-OPEN identity may be rejected by the guard with 401; missing sessions.read is 403. A grant/workspace/account change after the guard's earlier snapshot is rejected by the fresh service check with 403. A cursor from a previous workspace is invalid under the new authenticated context and may be 400. Assignment loss produces a successful empty scoped page, with no unrelated titles/counts or existence distinction. Malformed, mismatched or future cursor bounds are 400. Database failure is sanitized 503 SESSION_LIST_UNAVAILABLE, without raw errors/paths/credentials. No automatic work or session retry follows any read failure.

## Verification and changed files

Tests cover older RUNNING sessions alongside newer task sessions, exact minimal fields, no runner dispatch, current assignment/workspace scope including mismatched historical rows, broad admin grants, empty/inaccessible task filters, malformed query/cursor bounds, normalized filter and caller binding, more than 100 rows, equal timestamp ordering, creation cutoff, repeated cursors, deleted anchor, mutable status, grant/assignment/account/workspace changes between pages, unknown stop markers, sanitized failure and OpenAPI. Existing detail/history/auth tests remain applicable. Final cumulative **520 tests / 43 suites passed**; focused session HTTP/service regressions passed **71 tests / 2 suites**. TypeScript, ESLint, Prettier, Nest build and git diff checks passed. Independent code, test and documentation reviews found no outstanding actionable findings. Isolated database identity/port and out-of-recovery health were verified; its server was stopped after verification.

Files: src/sessions/session-list.ts; session-list.dto.ts; sessions.service.ts; sessions.controller.ts; test/session-deletion.http.spec.ts; this report; README.md. Fixture cleanup now removes tasks from both fixture-owned workspaces to cover cross-workspace test rows. No migration, production data/security change, stage, commit, push or deployment. Persistence uses only isolated localhost:55439/profile_test with all workers/provider integrations disabled; it is stopped after verification. Existing cumulative work remains preserved. Parent owns checklist status; no broader Home UI section is declared ready.
