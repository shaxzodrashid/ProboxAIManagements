# ADMIN02 atomic administration contract

## Authorization revision and edit snapshots

Workspace.authorizationRevision is an additive integer, default zero. It is a conservative workspace-wide token: role creation, metadata changes, permission replacement, role deletion, user-role replacement, administrative account creation, ban/delete and bootstrap authorization writes increment it in the same locked transaction. A successful identical set replacement still increments. An unrelated successful administrative change may cause a recoverable stale conflict; this prevents missing shared-role/self-union dependencies.

Production paths have `/api/v1` prefix:

| Endpoint                                | Contract                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET authorization/roles                 | Existing authorization.read list; each role includes the snapshot's workspace revision              |
| GET authorization/roles/:id/edit        | authorization.manage edit snapshot containing role permissions and revision                         |
| GET authorization/users/:userId/roles   | authorization.manage assignment snapshot containing id, roles and revision                          |
| GET authorization/revision              | authorization.manage; revision only; diagnostic/bracketed read token                                |
| PUT authorization/roles/:id/permissions | authorization.manage plus required quoted If-Match from the editable snapshot; complete replacement |
| PUT authorization/users/:userId/roles   | Same; complete replacement                                                                          |

Role/list/user-set reads use RepeatableRead, so data and revision share a database snapshot even when Prisma performs multiple relation queries. Management-only custom roles can obtain edit snapshots without authorization.read. Missing/foreign subjects are 404 on reads. Revision-only GET must never be fetched only at submission and paired with older staged sets. If a client uses multiple reads for dependent roles, bracket them with revision-before/revision-after and require equality. Keep input, reread current snapshots and resolve conflicts explicitly.

Missing If-Match is 428 REVISION_REQUIRED, malformed is 400 REVISION_INVALID, mismatched workspace revision is 409 STALE_REVISION. HTTP and direct whole-set service calls both require the token; no fallback to the latest revision. If a request reaches the transaction after its caller loses OPEN status, workspace or the operation's existing management grant, it returns 403 MANAGEMENT_ACCESS_CHANGED with the standard Forbidden error field. Authentication/guard/DTO failures may occur earlier. Scope validation inside the mutation follows revision checking, so a stale token can return 409 before a foreign/missing target is rejected; it never writes outside the actor workspace.

Permission/user-role replacements return their authoritative committed set and new workspace revision. Role create/metadata/delete responses also include revision. Lifecycle responses retain existing user DTO shape; reread current status through existing users.read list and the revision through authorization.manage where available. Lifecycle commands have no new If-Match requirement: their owner and self guards are atomic, and they do not replace staged sets. Existing terminal-to-terminal behavior is retained; this batch introduces no lifecycle transition policy.

## Atomic checks and preserved rules

All runtime role/assignment mutations and account create/lifecycle checks acquire the same Workspace row lock used by department and project creation. They reread the operation-specific actor permission under that lock. The account owner count, role assignment count, workspace/permission validation and complete permission-union checks occur inside the transaction before writes. Project creation rechecks the current actor's OPEN/workspace/projects.create before any path preparation. A ban winning first prevents project ownership creation; project creation winning first leaves the owner active and returns USER_OWNS_PROJECTS from ban/delete.

The original rules remain: callers cannot add permissions to their own effective union or lose their own authorization.manage; system roles cannot be deleted; a caller cannot delete their own assigned role; any assigned role cannot be deleted; self ban/delete is forbidden; owners of project records cannot be banned/deleted; lifecycle changes revoke active session tokens atomically. No last-administrator constraint or general caller-subset grant rule was added. Granting other users permissions outside the caller's current union remains permitted by the existing policy.

Role/permission replacement validates the complete requested set, deletes the old set, inserts the new set and advances the revision in one transaction. Confirmed validation/invariant/stale/database rejection commits neither partial sets nor a revision. Existing stable 400/404/409 business error codes remain. Unknown acknowledgement is not proof of failure: refresh the target edit snapshot/status before retry. A reread token and set identify the current committed state; a stale replay cannot overwrite it. This increment does not provide an immutable command/result ledger or distinguish a lost acknowledgement from a later unrelated update; resolve against the current authoritative state.

Seed now uses the workspace lock and commits role permission reset, bootstrap user/assignment and authorization token increment together. Its global permission catalog metadata upserts occur in that transaction. This changes seed coordination only; seed was not run against any real account and its existing configured bootstrap authority was not expanded.

## Consumers and migration cutover

Inventory: affected whole-set routes are called only by their controllers and repository HTTP tests; Telegram has no administrative mutation client, and bin is a Codex launcher. Internal account creation resolves roles within its transaction. Existing HTTP tests read edit snapshots via authorized GET; dedicated manage-only tests capture and retain explicit tokens through stale conflicts rather than fetching a new token at retry. Direct tests now pass explicit whole-set revisions.

Migration 20261011030000_authorization_revision only adds Workspace.authorizationRevision INTEGER NOT NULL DEFAULT 0. No existing permissions, assignments, lifecycle statuses, users or workspace memberships are backfilled or changed. Add-column DDL takes a table lock; deploy before new binaries. Coordinate writer/client cutover: older processes/scripts neither increment the token nor participate in locks, so guarantees do not hold with mixed-version or raw-database writers. The shared lock can wait behind project/home filesystem work; existing database timeout mapping yields OPERATION_OUTCOME_UNKNOWN 503 and requires readback. No automatic transaction retry can replay filesystem effects.

Only the isolated localhost:55439/profile_test database received this migration. Prior TEMPLATE02 duplicate-draft and NOT VALID archived-default preflight/validation requirements remain separate and unchanged. No production migration, permission change, seed, filesystem or storage operation was performed.

## Verification and exact files

12 added real PostgreSQL tests cover one-winner complete-set replacements, self-union rules, stale dependent-role changes, both assignment/deletion orders, actor revocation while queued, both project/ban orders, account-create/deletion contention, actual commit with lost acknowledgement and trigger-injected insertion rollback. Existing filesystem and initialization regressions are retained. HTTP tests verify manage-only snapshots, required/malformed/stale tokens, foreign isolation, coherent readback and actor revocation after the guard snapshot.

Changed for ADMIN02:

- prisma/schema.prisma; prisma/migrations/20261011030000_authorization_revision/migration.sql; prisma/seed.ts; prisma/bootstrap-user.ts
- src/prisma/current-management.ts; src/authorization/authorization.service.ts; authorization.controller.ts; authorization.dto.ts
- src/accounts/accounts.service.ts; src/projects/projects.service.ts; src/openapi/revision.ts; src/openapi/operation-errors.ts
- test/admin-concurrency.persistence.spec.ts; test/authorization.service.spec.ts; accounts.service.spec.ts; projects.service.spec.ts; admin-department.http.spec.ts; admin-department.errors.spec.ts; self-profile.persistence.spec.ts; mutation-concurrency.persistence.spec.ts
- Docs/admin-atomicity-contracts.md

FILE03 remains separate and open: current filesystem trash/restore operations still need a durable operation identity and observable repair states. Project purge is outside this batch. Public identity/profile work remains held.

Final local verification: 321 tests / 36 suites passed with the isolated database, including 12 new real PostgreSQL administrative races/faults and the manage-only HTTP/guard-snapshot regression. Typecheck, lint, build, formatting and git diff --check passed. Independent final review found no outstanding findings. Work remains uncommitted on main at 31fdd5a9d9a9bf19d6268c24504496bb54b75e2a; all previous batches are preserved.
