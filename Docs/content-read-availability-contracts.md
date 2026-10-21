# Content-read availability contract

Later increment: `authorization-get-availability-contracts.md` extends this same
established classifier to five existing authorization GET entry points. Its
separate before/after evidence preserves mutation-outcome handling.

Known database availability failures after successful authentication must not
become generic500 responses, empty lists, missing resources or invalid credentials.
The isolated HTTP reproduction on current source returned500 for six affected
reads; the7 existing negative-path assertions passed before the fix.

## Existing routes covered

| GET route                                | Failure action       |
| ---------------------------------------- | -------------------- |
| /api/v1/users/me                         | readSelfProfile      |
| /api/v1/users/me/telegram-link           | readSelfTelegramLink |
| /api/v1/users                            | listUsers            |
| /api/v1/projects                         | listProjects         |
| /api/v1/projects/:id                     | readProject          |
| /api/v1/tasks                            | listTasks            |
| /api/v1/tasks/:id                        | readTask             |
| /api/v1/chat-groups/:groupId             | groups.read          |
| /api/v1/chat-groups/creations/:requestId | groups.read          |

The route scopes, guards, current account/workspace/permission checks, selectors,
transaction isolation and success DTOs are unchanged. The user list still requires
users.read; task/project read-all grants still do not bypass their documented
resource boundaries. Actual missing data and denied inputs remain404/400/401/403.

## Failure response

Known Prisma connection/configuration, timeout and pool failures and client
initialization failures return503 with the existing ApiErrorResponseDto envelope:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "Requested data is temporarily unavailable",
  "code": "READ_DEPENDENCY_UNAVAILABLE",
  "action": "readSelfProfile"
}
```

Only the static action varies by route. Database messages, addresses, credentials,
Prisma metadata, token values and personal identifiers are excluded. OpenAPI now
explicitly documents this content-read error alongside authentication availability.

The classifier is intentionally narrow: P1000/P1001/P1002/P1003/P1008/P1010/P1011/
P1017/P2024/P2037 and PrismaClientInitializationError. Constraint, query/schema,
transaction-semantic and unknown/programming errors keep their existing handling;
no catch-all turns them into supposedly transient failures. Existing HttpExceptions
retain their original identity. Login uses the same extracted classifier with its
original authentication message/behavior; credential checks and signing stay outside
that dependency wrapper.

## Frontend behavior and safety

Treat this as unavailable **data**, not a sign-out or an empty success. Keep the
authorized context/draft, show an unavailable state, and allow a deliberate GET
retry. This change adds no automatic retry. Authentication denial remains a
separate401/403 contract. Do not apply read-retry guidance to a mutation.

The helper is applied only to the listed side-effect-free reads/read transactions.
It must not classify write commit outcomes. Profile writes, role/lifecycle changes,
task/project creation, retained request receipts and unknown-write reconciliation
retain their existing semantics. No new endpoints, permissions, models, migrations,
dependencies, storage configuration, provider calls or production settings are added.

## Verification

The before-fix run is retained locally as `proboxai-content-read-before.log`:
6 failures showed expected503/received500 after real JWT verification and current
persisted account lookup. The database, guards and services were real; only the
specific later content query was failed through an injected Prisma transport error.
The controlled harness used only the exact isolated profile_test loopback database.

The new HTTP suite verifies the sanitized body, recovery by a subsequent real read,
unknown content failures remaining500, missing resource/input/permission denials,
and generated503 contracts on all six routes. Unit tests cover all classified
availability codes, initialization failure, no retry, preserved business/unknown
failures and real null/empty results. Final focused/full results are recorded in
the accompanying evidence after source freeze; historical baseline totals are not
substituted for new verification.

Final verification: 1,332 tests / 74 suites passed against the isolated loopback
database. Lint, TypeScript, formatting, build and release checks passed. The
metadata-only export verifies all six documented 503 contracts and 175 operations.
See [batch evidence](backend-reliability-verification-20261019.json) for hashes,
reproduction logs and local-only limits.

The follow-up extends the same handling to project detail and the two creator-only
group metadata reads. Their three transport failures and missing OpenAPI contracts
were reproduced separately; the focused read/group/helper run passes75 tests in3
suites. Group transaction-semantic errors keep their existing separate mapping.
See [remaining contracts](remaining-backend-contract-boundaries-20261019.md) and
[follow-up verification](metadata-read-verification-20261019.json). This brings
the covered route total to nine; the earlier six-route evidence remains historical.
Final cumulative regression after this extension: 1,336 tests / 74 suites pass;
static/build/release checks and all nine metadata-export contracts pass.
