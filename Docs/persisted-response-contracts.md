# Initialization, protected-extension and webhook response contracts

This local increment closes the remaining successful-response schema inventory
without changing authorization, worker behavior, storage, message delivery or
product semantics. The nine inventory entries were eight missing nonempty models
and one intentionally bodyless webhook response, not nine missing runtime features.

## Initialization attempts and cancellation

Existing initialization-read permission and project scope still govern list/detail.
Their responses include all currently returned persisted attempt scalars and
position-ordered step records, including nullable operational paths, lease fields,
errors, timestamps and bounded stdout/stderr with outputTruncated. Both status
enums include every persisted lifecycle value. These are the existing gated
operational records, not a newly public projection or executable client input.

Retry retains its existing manage gate and returns HTTP201 with only the newly
registered attempt scalars. It omits steps; omission is not an empty step history
or evidence execution finished. The worker may advance after the registration
snapshot. Use attempt detail/events for progress. A missing/failed response does
not prove no attempt was registered; reconcile existing attempts before retrying.

Successful cancellation returns exactly `{cancelled:true}` with HTTP200. It records
the cancellation transition and attempts applicable local signals, but does not
prove all descendants stopped or staging was quarantined. The old description
claimed both; it is corrected. Cancellation does not supply a new stop-confirmation
or writer-containment contract. Reconcile status/events after an uncertain result.
Manage-only retry remains supported without adding the list-read permission.

## Protected file-extension rules

List/add/update return the existing scalar rule: id, projectId, extension,
createdById, createdAt and updatedAt. List is ordered by extension. The HTTP input
retains its 64-character bound, requires a leading dot after trimming and normalizes
case/boundary whitespace. No missing-dot prefix is silently added. OpenAPI now
documents that existing bound and syntax.

Append/upsert reuses an existing normalized rule and its original creation actor.
Owner update likewise retains creation attribution. Update/removal remain actual
project-owner actions; list/append retain their existing sensitive project scope
and projects.files.delete gate. Membership/read/manage role labels do not create
new authority. Removal returns exactly `{removed:true}`; removing an absent rule
still returns404. This acknowledges rule removal, not deletion of any file bytes.

## Telegram webhook acknowledgment

The existing webhook returns HTTP200 with an **empty body** for successful handled
or ignored updates, including quiet secret rejection. It does not return a JSON
`ok` or `accepted` object. The secret header remains required for processing.
The acknowledgment does not prove dispatch, eventual delivery or read state.
No webhook authentication, retry/receipt, contact-verification or messaging behavior
is changed. Tests use controlled bot/contact-service mocks and send no real messages.

## Schema regression guard

`scripts/verify-api-docs.mjs` now requires an explicit schema for each declared
nonempty HTTP200/201/202 response. The single verified empty webhook response is
allowlisted by exact method/path/status and must stay bodyless and documented as
empty. This catches future missing models without fabricating a webhook payload.
Existing reference, starter-body, header and upload-field checks remain intact.

## Exact files

```text
src/projects/initialization-response.dto.ts
src/projects/protected-file-types.dto.ts
src/projects/project-initializations.controller.ts
src/projects/projects.controller.ts
src/projects/projects.dto.ts
src/accounts/accounts.controller.ts
scripts/verify-api-docs.mjs
test/persisted-response-contracts.http.spec.ts
Docs/persisted-response-contracts.md
Docs/readiness-catalog-contracts.md
Docs/backend-ui-handoff.md
Docs/api/README.md
Docs/api/openapi.json
Docs/api/endpoints.json
Docs/api/postman-operation-docs.json
```

No runtime service/authorization change, migration, new grant, credential or live
storage operation is introduced. Existing uncommitted user/Profile/shared-task work
is preserved. Creator-only confirmation remains intact; mirror content/history,
edit/deletion propagation and reopening remain proposal-only. Status limits remain
API100/database300. No cloud publication, push, deployment or production migration.

## Verification

The focused contract/initialization/template/webhook run passed 84 tests in five
suites. The final frozen-source run passed **1,179 tests in 64 suites**, including
all ten new contract cases and existing authorization and persistence regressions.
Local API export and embedded-contract checks pass for all 172 operations across
27 controllers; the success-schema guard finds no unexplained missing models.
Postman OpenAPI syntax lint reports no issues. Prisma validation passes and all
34 existing migrations are current in the isolated loopback test database.
Typecheck, lint, formatting, build, release checks and `git diff --check` pass.
The protected README and linked-agent assessment retain their original SHA256 hashes.
