# Readiness and managed-catalog contract corrections

Independent backend correctness work on the preserved local dev patch, separate
from unresolved shared-task visibility/reopening and deferred avatar provisioning.

## Public readiness failure handling

`GET /health` retains its liveness-only `{status:"ok",service:"proboxai"}` response
and does not invoke persistent dependencies. `/health/ready` retains its existing
PostgreSQL-first, template-storage-second checks and successful envelope:
`{status:"ok",service:"proboxai",dependencies:{postgres:"ok",minio:"ok"}}`.

Failures return HTTP503 and the existing three-field unavailable envelope with
the stable message `Required persistent dependencies are unavailable`. Raw error
messages, connection URLs, private paths, object/bucket details and arbitrary
exception string conversion no longer leave this public route. Reproduction
proved the previous connection/storage-message disclosure and a secondary500
from a rejected object's throwing toString implementation.

Explicit OpenAPI DTOs now cover the successful dependencies and custom unavailable
body; this endpoint does not use the generic resource-error envelope. HTTP status
remains authoritative. Failed checks are reevaluated on the next request rather
than cached as permanently unavailable. A database failure still short-circuits
the storage check. Template readiness and its preexisting bucket behavior are not
changed; avatar readiness, runner liveness and per-feature readiness are not implied.
Tests use mocks and never call real storage or create a bucket.

## Managed session model catalog

`GET /sessions/model-catalog` retains its current OPEN authentication and
`sessions.create` gate, provider filtering, runtime fields, model defaults and
selection validation. New response DTOs describe version, providers, each provider's
defaultModel/models, and each model's displayName/defaultReasoningEffort/
supportedReasoningEfforts. The vocabulary enum does not mean every effort is
supported by every model; use the selected model's actual returned list.

This documents the current managed catalog, not live vendor availability, account
credentials, pricing, a new provider integration or model-preference synchronization.
Unknown providers and unsupported query selectors remain400, missing credentials
401, missing permission403 and authentication dependency failure503. No runner or
recovery worker starts when these HTTP/schema tests read the catalog.

## Exact files

```text
src/health.controller.ts
src/sessions/model-catalog.dto.ts
src/sessions/sessions.controller.ts
test/health.http.spec.ts
test/model-catalog.http.spec.ts
Docs/readiness-catalog-contracts.md
Docs/api/README.md
Docs/api/openapi.json
Docs/api/endpoints.json
Docs/api/postman-operation-docs.json
Docs/backend-ui-handoff.md
```

No schema migration, credentials, storage configuration, role grants, token/session
policy, deployment, production migration, push or cloud Postman publication is part
of these corrections. API status text remains100 and database capacity300.

## Remaining independent contract coverage

The later [persisted-response contract increment](persisted-response-contracts.md)
closes this success-schema list: eight missing models were documented and the
webhook's intentional empty response is now verified as such. The list below
records discovery before that increment and is no longer pending work.

The success-schema inventory also found existing operations that can receive a
separate source-backed DTO/test pass without deciding mirror visibility or reopening:

- Initialization attempt list/detail/cancel/retry: document each actual operation's
  persisted shape and whether steps are included; preserve existing read/manage
  scopes and avoid claiming cancellation proves all descendant processes stopped.
- Protected-file-extension list/add/update/remove: document current scalar records
  and removal acknowledgment under the existing sensitive/owner gates.
- Telegram webhook acknowledgment: document its existing success body without
  changing webhook authentication, delivery retry or external messaging behavior.

These are contract/test backlog, not evidence those runtime capabilities are absent,
not a reason to pause independent backend work, and not approval for a new public
projection, retention policy, permission or storage behavior.

## Verification

Final frozen-source run: **1,169 tests / 63 suites passed**, including eight new
readiness cases, six model-catalog HTTP/schema cases and existing auth/permission
regressions. The focused readiness/catalog/auth run passed65 tests in five suites.
Typecheck, lint, format, build, release and `git diff --check` pass. Local export,
embedded references, starter bodies and OpenAPI syntax checks pass for172 operations
across27 controllers. No cloud publication or live readiness/storage request ran.
The parallel creator-confirmation increment is documented in
[shared-task contracts](shared-human-task-contracts.md); no extra migration was
needed and all34 existing migrations remain applied only to the isolated test DB.
