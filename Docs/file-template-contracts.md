# FILE01 / FILE02 / TEMPLATE01 contracts

Paths below use deployment prefix `/api/v1`. Existing permissions, workspace
isolation, lifecycle gates and successful operation statuses are preserved.
No migration, new grant, production storage request or live settings change is
part of this batch.

## Effective upload configuration

`GET /projects/:id/files/upload-configuration` requires `projects.files.write`,
existing project-sensitive access (member or `projects.manage-all`) and READY,
matching upload authorization. Response:

```json
{ "maxUploadBytes": 104857600, "requestMode": "single-file" }
```

`GET /configuration-templates/upload-configuration` requires
`configuration-templates.manage`, matching template upload permission. It is
configuration metadata, not a draft or object-storage health check:

```json
{
  "maxFileBytes": 104857600,
  "maxVersionBytes": 1073741824,
  "requestMode": "single-file"
}
```

These are illustrative defaults, never client substitutions for a failed read.
Project, template-file and template-version values are resolved independently
from their existing environment variables. Positive safe integers are capped
at 1 GiB; invalid/missing values use the existing server defaults. Both metadata
and multipart interceptors resolve the same configuration per request. Single
file means one multipart `file`; project uploads additionally accept optional
folder `path`, template uploads require `destinationPath`.

Exactly the effective per-file maximum is accepted; maximum + 1 is 413.
The parser threshold is maximum + 1 because Multer treats reaching its threshold
as truncation; service checks enforce the advertised maximum. Project service
also checks declared size against the received buffer. Template services retain
the per-version aggregate check; aggregate maximum is accepted and excess is
400 `TEMPLATE_VERSION_LIMIT`. Every server upload remains checked.

**TEMPLATE02 remains open:** checking the version total and registering the file
are separate operations. Concurrent uploads can each pass the check and exceed
the aggregate quota. FILE01 publishes the effective configured total and covers
single-request boundaries; it does not claim serialized concurrent enforcement.

## File deletion and Trash

POST delete retains 201 and has a published `oneOf`:

- Protected path: `{confirmationRequired:true,confirmationId,expiresAt}`.
- Direct deletion: `{trashed:true,trashId,path,expiresAt}`.

Confirmed deletion retains 201 with the latter shape. No new discriminant
field is added to existing runtime responses; the literal true property and
required fields distinguish the branches.

Trash GET retains 200, selecting ACTIVE rows newest-first by createdAt. Public
record fields are id, projectId, originalPath, isDirectory, deletedById, status,
expiresAt, createdAt, restoredAt and purgedAt. All dates are ISO strings; the
latter two are required nullable properties. Trash paths, leases and internal
errors are excluded by an explicit allowlist. ACTIVE-but-expired rows can remain
visible until cleanup, and must not be described as restorable.

Trash listing needs `projects.files.delete` and sensitive access but no READY
gate. Delete/confirm/restore need the same grant/access and READY. Restore retains
201 `{restored:true,path}`. Expired/nonrecoverable items remain 404; restore-path
collision, changed/expired/consumed confirmation and non-READY mutations retain 409. Missing source paths remain 404; existing authorization/error behavior is
unchanged. Restored rows disappear from the ACTIVE list.

## Template projections and recovery

OpenAPI now publishes distinct DTOs for:

- List: template scalars, minimal department id/name/slug and latest two visible
  version scalars descending by version.
- Detail: template scalars, the same department summary and full visible version
  history, with typed folders/files/ordered stages/commands.
- Creation: template scalars, department summary and draft version scalars.
- Metadata PATCH and archive POST: template scalars only (200 and 201).
- Draft clone, manifest PUT and publish POST: full manifest (201, 200 and 201).
- File upload/move: file metadata (201/200); removal: `{deleted:true}` (200).

Reader visibility remains ACTIVE templates/PUBLISHED versions. Managers retain
archived templates and drafts. Archived templates cannot receive new drafts;
other existing draft edit/publish rules remain unchanged. Manifest save retains
registered files and returns them. Storage object keys and department home paths
are excluded from every public template operation while internal runner/clone
queries retain their required storage metadata. Structured legacy null argv
projects as `[]`; shell argv projects as null.

Expected domain errors preserve `{statusCode,error,message}` and add stable code,
action and where applicable field/`issues[]`. Manifest issue locations use visible
field/index paths such as `commandStages.0.commands.1.arguments` or
`files.0.destinationPath`, never internal storage paths.

- `TEMPLATE_MANIFEST_INVALID` with issue codes: `PATH_INVALID`, `PATH_DUPLICATE`,
  `PATH_ANCESTOR_CONFLICT`, `FILE_PARENT_INVALID`, `COMMAND_FOLDER_INVALID`,
  `COMMAND_MODE_INVALID`, `COMMAND_ARGUMENTS_INVALID`, `TEMPLATE_OBJECT_MISSING`
  and `TEMPLATE_OBJECT_MISMATCH`. Existing 400/409 validation distinctions remain.
- 409 `TEMPLATE_SLUG_CONFLICT`, `TEMPLATE_VERSION_CONFLICT`,
  `TEMPLATE_FILE_CONFLICT`, `TEMPLATE_ARCHIVED`, `TEMPLATE_DRAFT_EXISTS`,
  `TEMPLATE_PUBLISHED_VERSION_MISSING`; 400 file/version limit codes.
- 404 `RESOURCE_NOT_FOUND` / `TEMPLATE_DRAFT_NOT_FOUND` preserve scoped absence;
  published or foreign drafts do not become writable.
- 503 `TEMPLATE_STORAGE_UNAVAILABLE` means configuration/authentication/network/
  infrastructure failure, not evidence that a file disappeared. A confirmed
  HeadObject 404 is a missing-object issue; bucket failures are sanitized as
  unavailability. Bucket auto-creation is still opt-in, and now only attempted
  after a missing-bucket 404, never after authentication/network failure.
- Known rejected database writes retain sanitized 404/409 categories; unexpected
  errors remain 500 with potentially unknown outcomes. Reread before retrying.

Unknown file-registration outcomes preserve the newly uploaded object because
registration may have committed. Known rejected writes retain cleanup. Disk
streams are closed before temporary spool cleanup, including immediate storage
rejection. These are failure safety improvements, not new storage permissions.

## Changed files and verification

- `src/projects/projects.controller.ts`, `projects.dto.ts`, `projects.service.ts`
- `src/configuration-templates/configuration-templates.controller.ts`,
  `configuration-templates.dto.ts`, `configuration-templates.service.ts`,
  `template-storage.service.ts`
- New `src/configuration-templates/template-response.dto.ts`,
  `template-projections.ts`, `template-errors.ts`
- New `src/storage/upload-limits.ts`; `src/openapi/api-docs.ts`
- New `test/file-template.http.spec.ts`, `file-template.openapi.spec.ts`,
  `upload-limits.spec.ts`, `template-storage-errors.spec.ts`
- This document, privacy implementation plan and README references

HTTP tests use real Nest guards/services and the isolated localhost PostgreSQL
database with temporary local files and fake object storage. Storage adapter
tests use mocked SDK calls only. Tests cover projection/privacy, visibility,
union branches, confirmation/restore outcomes, expired ACTIVE rows, permissions,
READY differences, effective configuration boundaries, storage error distinctions,
and unknown registration cleanup. A separate reviewer found no outstanding
regressions after the safety fixes. Space checkbox updates remain with the parent.

Final cumulative gate on 2026-10-11: **262 tests / 32 suites passed**, including
all earlier batches and opt-in database integration suites. Typecheck, ESLint,
build, Prettier and diff checks passed. The isolated temporary PostgreSQL server
was stopped after verification. All work remains safely uncommitted on the
existing checkout; no push, merge or deployment occurred. FILE01, FILE02 and
TEMPLATE01 were complete at that batch boundary. The subsequent TEMPLATE02
implementation, revision preconditions and final verification are documented in
[mutation-concurrency-contracts.md](mutation-concurrency-contracts.md).
