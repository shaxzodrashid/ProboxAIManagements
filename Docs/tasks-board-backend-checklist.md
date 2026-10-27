# Tasks board backend implementation checklist

Local backend implementation; no deployment or shared/production migration performed.

- [x] Unified query: opt-in scope=all combines original/shared cards; local status, counts, filters and generation-bound pagination. Existing default original scope retained.
- [x] Persisted column ordering: beforeTaskId on existing original/shared moves; current assignment/permission checks, workspace serialization, task revisions and durable request recovery. Omitted placement retains same-column position; legacy sharing hashes preserved.
- [x] Realtime: persisted-state SSE invalidations with fresh OPEN membership, credential/session revocation and expiry checks. Opaque tokens only; reconnect always reconciles REST. Changes can coalesce; no audit replay guarantee.
- [x] Avatars: fresh caller-specific AVATAR audience projection, owner-directed contacts, custom recipients, ACTIVE assets, inactive identity omission; no profile metadata in frozen outcomes.
- [x] Browser proxy and OpenAPI updated; integration coverage includes cookie auth, CSRF, revisions, recovery, filters, deadlines and stream transport.
- [x] Frontend handoff updated in frontend/tasks.md; existing ownership, sharing, checklist, deadline and session-launch contracts retained.
- [x] Final focused and aggregate test verification recorded below.

## Validation and resource handling

Source migration: 20261027150000_task_card_positions. Applied only to the disposable localhost:55439/profile_test fixture (54 migrations). Regenerate Prisma before deploying the new backend. New integer labels default to zero for existing cards; deterministic creation/id ties remain until placement normalizes a column.

Final validation on 27 October 2026, using only the isolated fixture:

- Focused: 7 suites passed, 291 tests passed, 0 failed (84.342 seconds). Includes original/shared query, ordering/recovery/concurrency, privacy, browser transport, auth and project archival. The earlier six-suite checkpoint also passed 267 tests.
- Aggregate: 113 suites passed, 2149 tests passed, 0 failed (458.576 seconds), run with PROFILE_TEST_DATABASE_URL pointing only to localhost:55439/profile_test.
- pnpm typecheck: passed (exit 0).
- pnpm lint: passed (exit 0).
- Changed test formatting and git diff --check: passed.

Supporting local logs: C:/Users/user/AppData/Local/Temp/proboxai-board-focused-final.log, proboxai-board-aggregate-final.log, proboxai-board-typecheck-final.log and proboxai-board-lint-final.log. The aggregate test command exited 0 and its finally cleanup reported server stopped. No unresolved implementation or validation blocker remains.

Fixture PostgreSQL is started and stopped within one test process scope with finally cleanup. The final aggregate command exited 0 and PostgreSQL shutdown completed successfully. Earlier superseded runs were reconciled before any replacement run; no overlapping Jest runs were launched.

Rollout prerequisites: apply the source migration in the normal approved deployment process, regenerate Prisma, deploy backend/proxy together, verify actual permissions and browser configuration, and assess SSE/database polling capacity. Each active board stream polls persisted state once per second. Profile display changes are refreshed on REST reads and do not generate task mutation events.

Completion semantics verified in source and tests: fresh original/unified/shared reads expose the persisted canonical TaskHumanState.completed (null until owner confirmation); frozen human mutation outcomes retain their existing projection. Checklist item completion and card moves never confirm canonical task completion.
