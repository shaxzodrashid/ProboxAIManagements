# TEMPLATE02 / DEPT03 concurrency contract

## Revision-aware client mutations

Department and template-version responses now include integer revision (existing rows start at 0). Successful state changes increment it; empty department PATCH and already-current default/archive no-ops retain it.

The following HTTP mutations require If-Match with one quoted revision, e.g. If-Match: "3":

- Department PATCH, set-default and archive.
- Template-version manifest replacement, file upload/move/removal and publish.
- Legacy PUT settings/projects-home. Its body now also requires departmentId from the current GET response, so a default switch cannot redirect a stale write onto another department. GET includes departmentId/revision. Department.homePath is authoritative; the deprecated Workspace.projectsHomePath is no longer mirrored in an independent postcommit write.

Missing header returns 428 REVISION_REQUIRED; malformed/wildcard/multiple/weak/out-of-range values return 400 REVISION_INVALID. A changed revision returns 409 STALE_REVISION. A published version returns 409 TEMPLATE_VERSION_IMMUTABLE. Clients must keep staged text/file selections, reread, compare and resolve before submitting a new revision. No automatic stale replay. This is an intentional client contract upgrade: old HTTP writers must send revisions.

Manifest/publish responses include revision. File upload/move and removal return versionRevision alongside their existing public fields; clients may also reread template details. Create/clone starts a new version at revision 0. No HTTP ETag cache contract is introduced; the DTO revision is the precondition token.

## Template atomicity

All manifest/file/publish writers claim a DRAFT version through an atomic revision/status conditional update and then reread its manifest while holding that version row lock. Every database change and revision increment is in the same transaction. A loser receives a recoverable 409, including writes already racing publication. Publish validates object metadata outside the database transaction, then claims the exact validated revision; a concurrent change prevents publication.

Registration rechecks declared parents, complete path layout, uniqueness and aggregate bytes under the claimed version lock. Move and manifest replacement also validate the resulting file/folder layout. No folder removal can strand a preserved file. Existing configured byte limits remain unchanged.

New-draft creation locks the parent template, rechecks lifecycle/draft state and clones inside that transaction. Concurrent clone requests intentionally produce one draft and one TEMPLATE_DRAFT_EXISTS 409. A partial unique index additionally enforces one draft per template. No existing draft is deleted or published by migration.

Objects upload before registration using unique keys. A confirmed registration rejection cleans only that unique unregistered object; deletion failures use the existing durable cleanup queue. Unknown commit outcomes preserve the object and registration for reconciliation. A storage 503 may have left an unregistered object; no successful registration is claimed. Reconcile the current version before reusing the destination or resubmitting retained file input. Storage failure/orphan investigation remains an operator responsibility; this batch does not introduce an object inventory API.

## Department / project atomicity

Department create/default/archive/name/home mutations and project creation share a transaction-held Workspace row lock. Default and archive guards run after the lock, not on an earlier snapshot. Default demotion increments that department's revision. Concurrent explicit default creations serialize: the later valid selection wins, with the demoted row's prior revision becoming stale. A workspace may still have no default.

Home changes check project existence while holding the same lock used by project creation. The project reselects its current department/default and lifecycle under the lock before path work and insertion. An archive that wins rejects project creation before directory preparation; a project that wins blocks a later home change. If a home change wins first, the project uses the new authoritative home. Name-only updates never write a captured home. A stale name/home request fails before provisioning.

Project and initial initialization-job records now commit in the same transaction. There is no postcommit enqueue failure handler that can incorrectly overwrite lifecycle after an unknown acknowledgement.

Filesystem operations are not transactional. Keep all provisioned directories on failure: homeCreated is an observation, not exclusive ownership, even for an empty directory. A confirmed database rejection does not prove a directory is unused by another department/workspace. Existing nested/shared-home policies remain unchanged; no universal nesting ban is added.

On a rejected or uncertain create/home update, reread department/project records, verify which home is authoritative and inspect the caller-requested directory before retrying. A failed project insertion can retain an empty directory, leading to the existing PROJECT_DIRECTORY_EXISTS choice on retry. KEEP/CLEAR remains an explicit existing contract; never silently reuse or clear. If an already-authorized CLEAR partially succeeds before a filesystem/database failure, its removed contents cannot be restored by database rollback. Inspect/reconcile before any retry. Unknown 500, OPERATION_OUTCOME_UNKNOWN 503 or transport loss is not proof that no database commit occurred.

## Migration and verification scope

20261011020000_mutation_revisions adds default-zero columns, a one-draft index and an active-default CHECK. The CHECK is NOT VALID to preserve any historical invalid rows for deliberate reconciliation; it immediately checks new/changed rows. Before future deployment, inspect duplicate draft groups and archived defaults, reconcile them intentionally, then validate the CHECK. Duplicate drafts cause index creation to fail rather than silently discard data. No production migration or validation was performed.

Real isolated PostgreSQL interleavings exercise both publication/write orders, stale manifests, concurrent uploads/quota/destinations/moves, concurrent clone/default/create, archive/project and home/project contention. Actual database triggers verify rejected project/initialization registration. An injected lost acknowledgement follows an actual committed upload transaction and verifies that its registered object is preserved. HTTP tests verify preconditions and authorization; cumulative existing filesystem/permission regressions are retained.

## Changed files in this batch

- prisma/schema.prisma; prisma/migrations/20261011020000_mutation_revisions/migration.sql
- src/prisma/workspace-lock.ts; src/openapi/revision.ts; src/openapi/operation-errors.ts
- src/configuration-templates/configuration-templates.controller.ts; configuration-templates.service.ts; template-errors.ts; template-projections.ts; template-response.dto.ts
- src/departments/departments.controller.ts; departments.dto.ts; departments.service.ts
- src/projects/projects.controller.ts; projects.dto.ts; projects.service.ts
- test/mutation-concurrency.persistence.spec.ts; configuration-templates.service.spec.ts; projects.service.spec.ts; admin-department.errors.spec.ts; admin-department.http.spec.ts; departments.update.spec.ts; file-template.http.spec.ts; file-template.openapi.spec.ts; template-command-arguments.spec.ts; template-storage-errors.spec.ts
- Docs/mutation-concurrency-contracts.md; file-template-contracts.md; admin-department-response-contracts.md

Final local verification: 306 tests / 35 suites passed, including 16 real-database concurrency/reconciliation HTTP tests. Typecheck, lint, build, formatting and git diff checks passed. Prisma database/schema diff returned no differences. Independent review found no outstanding issues after atomic project/job registration corrected the uncertain enqueue outcome. The isolated PostgreSQL server was stopped. All prior and new work remains uncommitted on main at 31fdd5a9d9a9bf19d6268c24504496bb54b75e2a.

## Repository consumer compatibility review

All paths below have production prefix `/api/v1`. Existing management grants remain sufficient; no additional read grant is required to obtain a precondition token.

| Required writer                                                  | Public revision readback                                                                                                                                            | Successful response                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| PATCH departments/:id                                            | GET departments/:id/revision (departments.manage); department detail/list under departments.read                                                                    | revision                                              |
| POST departments/:id/default                                     | Same                                                                                                                                                                | revision (and demoted department revision increments) |
| POST departments/:id/archive                                     | Same                                                                                                                                                                | revision                                              |
| PUT configuration-templates/versions/:versionId/manifest         | GET configuration-templates/versions/:versionId/revision (configuration-templates.manage); template detail/list visible versions under configuration-templates.read | revision                                              |
| POST configuration-templates/versions/:versionId/files           | Same                                                                                                                                                                | versionRevision                                       |
| PATCH configuration-templates/versions/:versionId/files/:fileId  | Same                                                                                                                                                                | versionRevision                                       |
| DELETE configuration-templates/versions/:versionId/files/:fileId | Same                                                                                                                                                                | versionRevision                                       |
| POST configuration-templates/versions/:versionId/publish         | Same                                                                                                                                                                | revision                                              |
| PUT settings/projects-home                                       | GET settings/projects-home under its existing settings permission; retain both departmentId and revision                                                            | departmentId, revision                                |

The narrow management GET endpoints return only `{revision}`, including for known archived/published resources in the caller workspace. They do not grant access to full department/template contents. Foreign/missing IDs return 404; lacking management permission returns 403. A read-only caller can use existing detail/list reads but cannot mutate. Narrow endpoints intentionally do not return resource IDs, lifecycle state or paths.

For authorized, well-formed mutation requests: missing If-Match is 428 REVISION_REQUIRED; invalid token is 400 REVISION_INVALID; stale token is 409 STALE_REVISION; a published template version is 409 TEMPLATE_VERSION_IMMUTABLE. Authentication/authorization and DTO/file validation can reject a request earlier. Retain unsaved input on conflict, reread and resolve explicitly; no automatic write retry is implemented. The token may change immediately after GET, which is precisely why the subsequent write must check it. Unknown acknowledgement requires readback/reconciliation before retry.

Inventory reviewed: every production caller of the affected service methods is a revision-decorated controller, except ProjectsService.setProjectsHome delegating to DepartmentsService.update. That adapter now requires both revision and pinned departmentId and passes the token unchanged. The other services retain optional revision parameters for pre-existing direct service tests; no shipped producer omits them. Their baseline/CAS serialization fallback is not a stale-client intent guarantee and must not be used by future staged-edit callers.

TelegramBotService and TelegramSessionRelay call project read/taskDirectory/download and session operations, not these department/template/settings mutations. Their source has no HTTP client for these routes, so no bot write adapter needs upgrading. Existing bot/module/relay/rendering/OTP tests were rerun. bin/proboxai.mjs is a Codex launcher; scripts/proboxai-create-home.sh is filesystem provisioning. There is no frontend or generated HTTP writer client in this checkout. External consumers remain a coordinated release requirement.

The existing admin/department and file/template HTTP test helpers now obtain tokens through authorized public revision GETs, rather than querying Prisma. Dedicated new manage-only HTTP tests use explicit captured tokens, verify successful increments/readback and stale 409 without replay, and prove read-only/foreign denial. Existing concurrency tests keep explicit stale tokens and legacy settings identity pinning.

## Deployment preflight and validation requirements

[mutation-revisions-preflight.sql](mutation-revisions-preflight.sql) contains read-only duplicate-draft, archived-default and constraint-validation queries. It contains the eventual VALIDATE command only as a comment. No production query or migration was run.

Default-zero integer columns preserve existing rows and permit old binaries to start, but old writers do not increment revisions or acquire the new workspace locks. Apply the migration before new binaries and coordinate all writers/clients; concurrency guarantees do not hold during mixed-version writes. The index creation is not CONCURRENTLY and table alterations/index/check installation take database locks; schedule deployment according to actual table size and workload.

Duplicate draft groups must be resolved deliberately before index creation; no automatic deletion/publication is authorized. Archived-default rows are retained by NOT VALID, but any subsequent UPDATE to such a row (even a name change) must satisfy the CHECK. Reconcile them before normal operation and execute ALTER TABLE ... VALIDATE CONSTRAINT only under a separate approved deployment. Validation scans historical rows and can fail; until successful, convalidated remains false. A workspace with no default remains valid.

The migration file has no explicit BEGIN/COMMIT: do not assume the whole migration rolls back if index creation fails. Inspect migration state and actual columns/index/constraint after any failure; reconcile and recover through the deployment process rather than blindly replaying ADD COLUMN. These are additive data changes, not a lock-free or failure-free rollout. Isolated clean-database application and schema parity were verified in the prior batch; production historical data has not been inspected.

Compatibility review verification: all 308 tests / 35 suites passed with PROFILE_TEST_DATABASE_URL targeting isolated localhost:55439/profile_test, including all five Telegram suites and both new manage-only HTTP tests. Typecheck, lint, build, formatting and git diff --check passed. The read-only SQL preflight returned no duplicate drafts or archived defaults in the isolated database and confirmed convalidated=false; no constraint validation was applied. Independent review found no outstanding code findings after the manage-only correction. Temporary PostgreSQL was stopped. This verification supersedes the earlier 306-test count.
