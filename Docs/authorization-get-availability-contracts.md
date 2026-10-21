# Authorization GET availability consistency — 20 October 2026

This bounded correction uses the established read-dependency classifier. It adds
no route, permission, grant, model, migration or authorization default. Successful
responses, resource/permission checks, revisions and mutation outcomes are preserved.
Final counts and exact hashes are in
`authorization-get-availability-verification-20261020.json`.
Final frozen-source regression: **1,667 tests /91 suites passed** in303.758 seconds.
Focused: **123 tests /4 suites passed** in14.061 seconds, zero failures/skips in both.
Typecheck/lint/format/build/release, Bash/ShellCheck,38 mock deployment scenarios,
unchanged schema parity and diff checks passed. The fixture stopped cleanly with
zero owned test processes or fixture-port listeners; the owned cache was removed.

## Reproduction and corrected entry points

Five real local HTTP assertions failed before the change: after the actual
authorization controller and current-account/permission guards admitted a
synthetic caller, a mocked Prisma P1001 at the later content lookup returned500
instead of the established sanitized503 response. The selected before-fix run
has5 failures and46 unselected/skipped assertions; those skips are test selection,
not a full regression result. The runtime source hashes and before log/JSON are
retained in the local evidence.

| Existing GET under `/authorization` | Required capability  | Failure action    |
| ----------------------------------- | -------------------- | ----------------- |
| `/permissions`                      | authorization.read   | listPermissions   |
| `/roles`                            | authorization.read   | listRoles         |
| `/revision`                         | authorization.manage | readAuthorization |
| `/roles/:id/edit`                   | authorization.manage | readRole          |
| `/users/:userId/roles`              | authorization.manage | readUserRoles     |

Each read entry now uses `readDependency` around its existing database read or
read transaction. Existing repeatable-read transactions and explicit projections
are retained. Missing workspace/role/user remains404. Missing current capability
remains403 before content lookup. Successful GETs remain no-store. The self
`/authorization/me` response and its guard-level failure handling are unchanged.

The503 envelope remains the existing `ApiErrorResponseDto` contract:
`statusCode:503`, `error:Service Unavailable`,
`message:Requested data is temporarily unavailable`,
`code:READ_DEPENDENCY_UNAVAILABLE`, and the static action above. No database
message/metadata, identity, credential, address or server path is included.
The five operations now explicitly document this post-authentication failure.

Only existing recognized connection/configuration/pool/timeout failures are
classified: P1000/P1001/P1002/P1003/P1008/P1010/P1011/P1017/P2024/P2037 and
PrismaClientInitializationError. Synchronous and asynchronous failures are covered.
Unknown, query/schema, constraint and transaction-semantic failures are not
relabelled; existing HttpExceptions retain their identity. There is no broad
catch-all, empty-data success, automatic retry or sign-out behavior.

## Mutation separation

`getRole(workspaceId,roleId,tx)` keeps its existing unwrapped behavior when a
transaction is supplied. Only its no-transaction read entry wraps the existing
read-only transaction. Role-permission mutations continue to supply their own
transaction. `getUserRoles` wraps the public read entry; `setUserRoles` continues
calling the separate private `userRoles(...,tx)` without the read wrapper.
Permission validation, role assignment, revision advancement and the existing
`databaseOperationError` mutation boundary are unchanged.

The tests deliberately fail the final role/user-role read after mock mutation
work has been reached, not an earlier validation lookup. P1001 retains existing
unknown500 mutation handling; P2028 remains503 `OPERATION_OUTCOME_UNKNOWN`;
P2034 remains409 `STATE_CONFLICT`. None becomes READ_DEPENDENCY_UNAVAILABLE.
An explicitly transaction-provided getRole failure preserves the original error
object. Existing real mutation/concurrency tests remain in full regression.

## Validation and handoff

The focused run passes123 tests across4 suites, zero failures/skips, including
51 new assertions plus existing authorization, authentication and classifier
tests. Coverage includes all five reproductions, synchronous and transaction-entry
faults, the narrow classifier, unchanged successful DTOs/no-store,403/404,
unknown/semantic error handling, nested mutation readers and OpenAPI.
Full frozen-source regression and final fixture shutdown are recorded separately
in the verification JSON; focused results are not substituted for them.

Keep the authorized context and entered data when a GET returns the established
503; permit a deliberate read retry. Mutation uncertainty retains its existing
readback/reconciliation flow. Do not apply read retry handling to writes.

All51 new tests use synthetic dependency fixtures; no live permission or credential
is changed or issued. The complete regression uses only the verified existing
localhost55439/profile_test fixture. No schema change or migration is required.
All previous group-history source hashes are preserved. No Postman, upload,
commit/push/deploy, production operation, paid call, agent, username/phone or
presentation feature is included. Article publication remains disabled.
