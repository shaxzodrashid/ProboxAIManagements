# Projects APIs: frontend integration guide

Reviewed against repository source on **22 October 2026**. Paths below include
`/api/v1`; JSON fields are **camelCase**, IDs are strings, timestamps are ISO 8601
strings, and nullable fields must remain nullable. Examples are illustrative, not
captured production responses. Deployment, migrations, worker availability, and
browser-session enablement have not been verified by this guide.

## Transport and current browser availability

Start with the [authentication guide](authentication.md). Browser SPA requests use
the same-origin HttpOnly session cookie, relative URLs, and
`credentials: "same-origin"`. Do not send an Authorization header to `/browser/*`
or put bearer tokens in browser storage.

| Frontend operation                  | Browser session route currently allowed                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List active projects                | `GET /api/v1/browser/api/projects`                                                                                                                                                |
| List archived projects              | `GET /api/v1/browser/api/projects?lifecycle=archived`                                                                                                                             |
| Read project details                | `GET /api/v1/browser/api/projects/:id`                                                                                                                                            |
| Read explicitly shared task content | `GET /api/v1/browser/api/projects/:projectId/shared-tasks` and `GET /api/v1/browser/api/projects/:projectId/tasks/:taskId/shared-content`, `shared-comments`, or `shared-history` |

**The current browser proxy does not expose project creation, settings edits,
member discovery/changes, initialization reads/actions/streams, files/downloads,
trash, archival, or project deletion.** It also does not expose the department and
configuration-template selectors used for creation. These requests return `404`
through the proxy, even if the caller has the corresponding permission. Adding a
CSRF token does not make an unlisted route available.

The original routes documented below require
`Authorization: Bearer <accessToken>`. A browser cookie does not authenticate them.
Management screens therefore need an explicitly implemented server-side transport
before they can work with browser sessions. Do not silently switch the SPA to
storing bearer credentials. Multipart uploads, binary downloads, and initialization
SSE each need transport support; the existing proxy is not a generic forwarding
service. There is no credentialed cross-origin CORS configuration in `src/main.ts`.

Browser proxy responses are `Cache-Control: no-store`; original project list/detail
and the explicitly marked readback endpoints also use no-store. Keep authorized
project state scoped to the current account/workspace. Exclude browser API responses
from service-worker caches and clear protected state at logout.

## Permissions and project relationships

Permissions come from current authorization, not role labels. A persisted project
membership, creator ownership (`creatorId` equals the current user's ID), public
workspace read access, and administrative permission keys are separate facts.
The backend rechecks authority; UI visibility never grants access.

| Operation                                            | Required capability               | Additional resource scope                                                                                    |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| List/detail                                          | `projects.read`                   | Membership, `readAccessEnabled`, or `projects.read-all`                                                      |
| Create and read own creation outcome                 | `projects.create`                 | Current OPEN account/workspace; outcome belongs to the original caller                                       |
| Edit description/read access                         | `projects.update`                 | Member or `projects.manage-all`                                                                              |
| Discover/add/remove members                          | `projects.members.manage`         | Member or `projects.manage-all`                                                                              |
| Browse/download files                                | `projects.files.read`             | Membership, public workspace read access, or `projects.read-all`; project must be READY                      |
| Create folder/upload/move; read upload configuration | `projects.files.write`            | Member or `projects.manage-all`; project must be READY                                                       |
| File deletion/trash/protection rules                 | `projects.files.delete`           | Member or `projects.manage-all`; changing/removing a protection rule additionally requires creator ownership |
| Initialization list/detail/events                    | `projects.initializations.read`   | Membership, public workspace read access, or `projects.read-all`                                             |
| Initialization retry/cancel/recovery                 | `projects.initializations.manage` | Both project read scope and member/`projects.manage-all` management scope                                    |
| Archive                                              | `projects.archive`                | Creator ownership; no manage-all or role-label ownership bypass                                              |
| Project deletion flow/readback                       | `projects.delete`                 | Owner/member restrictions and owner-only final approval/token steps; see deletion section                    |

Method-level permissions replace the controller's default permission. For example,
creation and own-submission readback do **not** additionally require `projects.read`;
initialization recovery does not additionally require `projects.initializations.read`.
The broader `projects.read-all` and `projects.manage-all` grants do not replace the
operation's capability. Public read access means users in the same workspace with
the appropriate capability; it is not anonymous internet access.

New mutations reject archived/deleting projects. Filesystem actions additionally
enforce readiness where stated. Membership/authorization can change between loading
the page and submitting an action; handle `403` and refresh authorized state.

## Project list and detail screens

| Method and original path                  | Success                    | Meaning                                                   |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `GET /api/v1/projects`                    | `200`: `ProjectListItem[]` | Accessible nonarchived projects, `updatedAt` descending   |
| `GET /api/v1/projects?lifecycle=archived` | `200`: `ProjectListItem[]` | Accessible archived projects only, same ordering          |
| `GET /api/v1/projects/:id`                | `200`: `ProjectDetail`     | Current scoped metadata; archived detail remains readable |

`lifecycle` accepts only `active` or `archived`; omitted means `active`. The list
returns a plain array, with no pagination envelope, total, search, department
filter, favorite flag, or server-provided ranking. Implement local display controls
over the returned accessible set without inventing query parameters.

An illustrative list response for an empty, ready project:

```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "workspaceId": "22222222-2222-4222-8222-222222222222",
    "departmentId": "33333333-3333-4333-8333-333333333333",
    "name": "Customer Portal",
    "directoryName": "Customer Portal",
    "description": null,
    "readAccessEnabled": false,
    "status": "READY",
    "appliedTemplateVersionId": null,
    "creatorId": "44444444-4444-4444-8444-444444444444",
    "archivedAt": null,
    "archiveRevision": 0,
    "createdAt": "2026-10-22T05:00:00.000Z",
    "updatedAt": "2026-10-22T05:00:00.000Z",
    "isMember": true,
    "creator": {
      "id": "44444444-4444-4444-8444-444444444444",
      "fullName": "Ada Lovelace"
    },
    "department": {
      "id": "33333333-3333-4333-8333-333333333333",
      "name": "IT",
      "slug": "it"
    },
    "_count": { "members": 1 },
    "initializations": []
  }
]
```

All project scalars shown above also appear in detail and scalar update responses.
Their relationship fields differ:

| Response      | Additional fields                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| List item     | `isMember`, `creator`, `department`, `_count.members`, `initializations`                                                                      |
| Detail        | `isMember`, `creator`, `department`, `initializations`; `members` only for members or callers with `projects.read-all`; no `_count` guarantee |
| Legacy create | `creator`, `department`, `members`; `initializations` present only for templated creation; no `isMember` guarantee                            |
| Update        | Project scalars only; no relationships or `isMember`                                                                                          |

`isMember` reports the current caller's persisted membership. Creator identity,
public read access, read-all, or manage-all does not make it true. Use it for a
membership indicator, not as a complete capability check. A missing `members`
property means the roster was withheld; do not display it as an empty roster.
`_count.members` counts persisted relationships, which may include inactive users;
it is not the active candidate count.

`initializations` in list/detail is an array of zero or one latest attempt, selected
by `attempt` descending. Its safe summary contains exactly:

```text
id, projectId, templateVersionId, attempt, status, lastSequence,
startedAt, endedAt, createdAt, updatedAt
```

`startedAt` and `endedAt` can be null. Summaries do not contain worker paths,
leases, raw errors, steps, or command logs. Load privileged initialization detail
only through its separately authorized endpoint.

### Lifecycle presentation

| Project `status` | Frontend behavior                                                    |
| ---------------- | -------------------------------------------------------------------- |
| `INITIALIZING`   | Show setup in progress; ordinary file operations are unavailable     |
| `READY`          | Files may be accessed with the appropriate grants and scope          |
| `FAILED`         | Show setup failure/recovery state; do not treat as a ready directory |
| `DELETING`       | Show deletion in progress; stop offering mutations                   |

Archival is independent: `archivedAt !== null` means archived even when `status`
is `READY` or `FAILED`. There is no `ARCHIVED` ProjectStatus. Archived projects
remain readable under existing read scope, but cannot accept ordinary mutations
or new execution. There is no unarchive action. A successfully loaded empty list
is different from loading, permission denial, or an unavailable request.

## Create project and recover the original outcome

Prefer `POST /api/v1/projects/creation-submissions` for new integrations. Generate
a UUIDv4 `requestId` **before** sending and retain it with the original input for
reconciliation. A second click, timeout, or reload must not silently create a new
operation identity. Do not include credentials in retained operation state.

### Creation form

| Field                     | Contract                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestId`               | Required UUIDv4 on creation-submissions                                                                                                                                                                                                                 |
| `name`                    | Required string, 1–120 ASCII characters; `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$`. First character must be a letter or digit. This is also the server directory name; no slashes. Windows additionally rejects trailing dots/spaces. Send a trimmed value. |
| `description`             | Optional string, at most 4000 characters; trimmed, empty/whitespace becomes null in responses                                                                                                                                                           |
| `readAccessEnabled`       | Optional boolean, defaults to false; preserve explicit false                                                                                                                                                                                            |
| `departmentId`            | Optional selected department ID; omitted selects the active workspace default                                                                                                                                                                           |
| `configurationTemplateId` | Optional template ID from the selected department with a published version; omit for an empty project                                                                                                                                                   |
| `existingDirectoryAction` | Optional `KEEP` or `CLEAR`, chosen deliberately after a directory-exists outcome                                                                                                                                                                        |

Omit unused optional fields rather than sending null. The validation pipe rejects
unknown body fields. The browser does not supply workspace/creator IDs, absolute
paths, `directoryName`, status, template-version pins, or member lists.

With `departments.read`, `GET /api/v1/departments` supplies active departments.
With `configuration-templates.read`,
`GET /api/v1/configuration-templates?departmentId=:departmentId` supplies template
options. Filter to ACTIVE templates with a PUBLISHED version, including when a
management caller can also see drafts/archives. List items include at most two
versions; a management caller may need `GET /api/v1/configuration-templates/:id`
to inspect older published versions before deciding that none exists.
Changing the selected department
must clear an incompatible template selection. These selector grants are separate
from `projects.create`; show their unavailable/forbidden states accurately.
The server pins the resolved department and exact published version for the
accepted submission; a later default/template change does not replace its pin.

```json
{
  "requestId": "55555555-5555-4555-8555-555555555555",
  "name": "Customer Portal",
  "description": "Customer-facing application",
  "readAccessEnabled": false,
  "departmentId": "33333333-3333-4333-8333-333333333333"
}
```

Success is **202**, with an outcome record rather than a full project:

```json
{
  "requestId": "55555555-5555-4555-8555-555555555555",
  "state": "COMPLETED",
  "projectId": "11111111-1111-4111-8111-111111111111",
  "initializationId": null,
  "departmentId": "33333333-3333-4333-8333-333333333333",
  "templateVersionId": null,
  "failureCode": null,
  "executionFinished": true,
  "willReplay": false,
  "createdAt": "2026-10-22T05:00:00.000Z"
}
```

The route awaits its attempt; `202` does not guarantee a quick response.

| Outcome                   | Required frontend decision                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`               | Project and any initial QUEUED setup job committed. Save returned IDs; load detail if permitted. It does not mean setup succeeded. |
| `UNRESOLVED`              | May be running, failed, crashed, or unconfirmed. Show unresolved/recovery state. Do not announce success or rollback.              |
| `executionFinished: true` | This local callback and issued awaits settled; does not turn UNRESOLVED into success or prove external processes stopped.          |
| `willReplay: false`       | Repeating an accepted identity reads its outcome; it does not resume/re-execute creation.                                          |

`projectId`, `initializationId`, `templateVersionId`, and `failureCode` can be null.
Failure codes in the outcome are `PROJECT_DIRECTORY_EXISTS`, `CREATE_REJECTED`,
or `CREATION_OUTCOME_UNKNOWN`. A `202` UNRESOLVED outcome with a failure code is
not a successful creation.

### Response loss, conflicts, and existing directories

1. After timeout, response loss, or `503 PROJECT_CREATION_OUTCOME_UNKNOWN`, read
   `GET /api/v1/projects/creation-submissions/:requestId` (`200`, no-store).
   It requires only current `projects.create` and returns the caller's own
   workspace-scoped outcome. Another actor's or unknown identity returns `404`.
2. Keep the same key and original input. A `404` does not prove an earlier request
   cannot still commit; reconcile the same key. An identical submission can
   recover/read that identity; an accepted record never replays filesystem work.
   Do not turn this into a repeated mutation loop.
3. Changed input under an accepted key returns `409 PROJECT_CREATION_ID_REUSED`.
   An overlapping unfinished operation can return `409 PROJECT_CREATION_UNRESOLVED`.
   Preserve the key and resolve the existing outcome before new work.
4. `PROJECT_DIRECTORY_EXISTS` requires a deliberate keep/clear choice. `KEEP`
   preserves existing files and cannot be combined with a configuration template.
   `CLEAR` permanently removes existing directory contents. Explain that effect
   before submission. Changed action/input requires a **new deliberate keyed
   submission after inspection**, never an automatic retry of an unresolved one.
5. A previously completed key remains historical after project deletion; reading
   or resubmitting it cannot recreate that project.

The legacy `POST /api/v1/projects` returns `201` with the project/relations described
above. Empty creation becomes READY; templated creation starts INITIALIZING with
a first attempt. The creator becomes the first member. Legacy creation has no
client-retained correlation key; `CLEAR` returns
`428 PROJECT_CREATION_ID_REQUIRED`. Use the keyed route for reliable readback.

## Edit project settings

`PUT /api/v1/projects/:id` accepts only `description` and `readAccessEnabled`:

```json
{ "description": "Updated project description", "readAccessEnabled": false }
```

Success is `200` with project scalars. Omitted fields remain unchanged; an empty
description clears it to null. Preserve false instead of dropping it during form
serialization. Name, department, directory, template pin, creator, membership,
status, and archival cannot be changed here. There is no revision header for this
operation; do not invent one.

Merge the scalar response into existing authorized relations, or refetch detail.
Replacing the entire detail object loses `creator`, `department`, `isMember`,
`members`, and `initializations`. After changing public read access or removing the
current membership, refetch and handle loss of access.

## Members and candidate discovery

| Method and original path                            | Request                               | Success                            |
| --------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| `GET /api/v1/projects/:projectId/member-candidates` | Query below                           | `200`: `{items,total,nextCursor}`  |
| `POST /api/v1/projects/:id/members`                 | `{ "userId": "<workspace-user-id>" }` | `201`: membership with nested user |
| `DELETE /api/v1/projects/:id/members/:userId`       | No body                               | `200`: membership scalars          |

Discovery requires `projects.members.manage` with member/manage-all scope;
`users.read` is not needed. Only current OPEN accounts in this project's workspace
are candidates. Existing inactive memberships can remain in detail/history but are
not offered as eligible new candidates. Selection itself grants nothing; add-member
checks current eligibility again.

| Query        | Values/default                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `q`          | Trimmed, literal case-insensitive public name/username substring, maximum 200 characters; default empty |
| `membership` | `all` (default), `members`, `nonmembers`                                                                |
| `sort`       | `id` (default), `-id`, `name`, `-name`, `username`, `-username`                                         |
| `limit`      | Integer 1–100, default 50                                                                               |
| `cursor`     | Opaque continuation, maximum 2048 characters; omit for first page                                       |

Text sort is case-insensitive, ties use ID ascending, and missing usernames are last
in either direction. Search does not cover phones, private aliases, or bios.

```json
{
  "items": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "displayName": "Grace Hopper",
      "firstName": "Grace",
      "lastName": "Hopper",
      "username": "grace.hopper",
      "isMember": false
    }
  ],
  "total": 1,
  "nextCursor": null
}
```

Names/username except `displayName` can be null. `total` is the exact eligible
count for the current filters/page snapshot; it can change between requests.
Continue with `nextCursor` until null. Reset pagination when the project, search,
filter, or sort changes; cursor scope includes actor/workspace/project and query.
Ignore stale responses after rapid changes and deduplicate loaded items by ID.

Membership scalars are `{projectId,userId,createdAt}`. Add-member additionally
returns `user: {id,fullName,roles:[{id,key,name}],role}`; singular `role` is deprecated
and nullable. Neither role representation replaces permission checks. Adding an
existing same-workspace membership returns it unchanged; removing a missing one
returns `404`. Refetch the roster, list count, and candidate page after changes.

## Template initialization and recovery

Use the project's latest summary for status badges. A submitted setup job is not
proof a worker is available or files are ready. Privileged detail/log routes use
the original bearer transport; current browser sessions cannot call them.

All paths in this table start with `/api/v1/projects/:projectId/initializations`:

| Method and suffix                                 | Success                                 | Purpose                                                        |
| ------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `GET` (no suffix)                                 | `200`: detail array, attempt descending | All attempts with position-ordered steps                       |
| `GET /:initializationId`                          | `200`: detail                           | Current stored attempt and bounded logs                        |
| `GET /:initializationId/events?after=0&limit=100` | `200`: persisted event array            | Replay an exclusive sequence cursor                            |
| `GET /:initializationId/events/stream?after=0`    | `200`: `text/event-stream`              | Replay and follow persisted events                             |
| `POST /:initializationId/cancel`                  | `200`: `{ "cancelled": true }`          | Cancel a QUEUED/RUNNING attempt                                |
| `POST /retry`                                     | `201`: scalar attempt                   | Deliberately create another attempt after FAILED/CANCELLED     |
| `GET /recovery`                                   | `200`: recovery state                   | Inspect a known project's missing first enqueue                |
| `POST /recover-enqueue`                           | `200`: registration result              | Ensure first registration for the exact persisted template pin |

Attempt statuses: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
Step statuses: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
Full attempts add `stagingPath`, `quarantinePath`, `leaseOwner`, `leaseExpiresAt`,
and `error` to the summary fields. These nullable privileged fields are not
client-selected paths or process-liveness evidence. Detail adds `steps`, each with
`id`, `initializationId`, nullable `commandId`, `key`, `kind`, `position`, `status`,
nullable `stdout`, `stderr`, `exitCode`, `error`, `startedAt`, `endedAt`, and
`outputTruncated`. Render logs/errors as untrusted text. Retry returns the scalar
attempt without `steps`; fetch its detail for progress.

REST events contain `{id,initializationId,sequence,type,payload,createdAt}`. `after`
is an integer 0–2147483647, default zero; `limit` is 1–100, default 100. Advance
using the last returned sequence; a full page can have more. SSE uses the numeric
sequence as its event `id`, the persisted type as `event`, and payload as JSON
`data`. Do not assume every event arrives as the default `message` event.
Deduplicate by initialization ID and sequence. SSE accepts `after` or
`Last-Event-ID`; if both are supplied they must agree. Do not send `limit` to SSE.

On disconnect, reconcile REST history/detail before reconnecting; access/token
expiry can end the stream. `409 INITIALIZATION_HISTORY_UNAVAILABLE` means history
has a gap, not that setup should be retried. Direct bearer streams need a client
that can supply an Authorization header; do not put tokens in stream URLs.

Cancellation records a transition and attempts local signals; it does not prove
all child processes stopped. A lost retry response is not proof no new attempt
was created: reread attempts before another deliberate action. Cancellation and
retry are not generally idempotent creation operations.

### Missing first initialization

Recovery is for a **known project ID** with a pinned template and no attempt,
separate from original project creation readback. `GET /recovery` returns:

```text
projectId, projectStatus, pinnedTemplateVersionId,
state: NO_ATTEMPT | ATTEMPT_EXISTS,
canRegisterInitialSetup, blockedReason,
latestAttempt: null | {id,templateVersionId,attempt,status}
```

`blockedReason` is null, `ATTEMPT_EXISTS`, `NO_PINNED_TEMPLATE`,
`PROJECT_NOT_RECOVERABLE`, or `PINNED_TEMPLATE_UNAVAILABLE`.
Only eligible FAILED/INITIALIZING projects without attempts can register initial
setup; an actual failed/cancelled attempt uses the explicit retry flow instead.

Send `{ "templateVersionId": "<exact pinnedTemplateVersionId>" }` to
`POST /recover-enqueue`. Never substitute the newest template. Response:

```text
{registered:true, created:boolean, projectId, projectStatus,
 pinnedTemplateVersionId,
 initialization:{id,templateVersionId,attempt,status}}
```

`created: true` means attempt 1 was registered by this request, not executed.
Repeating the same project/template operation returns the first attempt with
`created: false`, even if it has since finished or later retries exist.
After `503 PROJECT_ENQUEUE_OUTCOME_UNKNOWN`, reread recovery state and reconcile
the same project/pin. Do not recreate the project or clear its directory.

## Files, folders, and downloads

These routes require an explicitly supported management transport. A normal link
to an original download URL will not supply the required bearer header.
All suffixes below follow `/api/v1/projects/:id`:

| Method and suffix                 | Request                                                                     | Success                                                   |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /files`                      | Optional `path` query; omitted/empty means root                             | `200`: `{path,files:[{name,path,type,size,updatedAt}]}`   |
| `POST /folders`                   | `{ "path": "src/components" }`                                              | `201`: `{path,type:"directory"}`; creates missing parents |
| `GET /files/upload-configuration` | No body                                                                     | `200`: `{maxUploadBytes,requestMode:"single-file"}`       |
| `POST /files/upload`              | Multipart `file` plus optional destination folder `path`                    | `201`: `{name,path,size}`                                 |
| `POST /files/move`                | `{ "sourcePath": "drafts/readme.md", "destinationPath": "docs/readme.md" }` | `200`: `{sourcePath,destinationPath}`                     |
| `GET /files/download`             | Required `path` query                                                       | `200`: binary attachment, `application/octet-stream`      |

Use project-relative paths, normally `/` separators, maximum 1024 characters on
DTO path fields. URL-encode query values. Absolute paths, traversal, unsafe
segments, symbolic-link access, and the reserved trash area are rejected.
Directory entries may report `type: "file" | "directory" | "symlink"`; show a
symlink as unsupported for navigation/actions. `size` is bytes or null for nonfiles.
Directory listings are not paginated and have no specified sorting guarantee.

Read effective upload configuration before accepting a file; do not substitute a
hardcoded limit after a failed request. One request carries one `file`; multipart
clients must let the runtime generate the Content-Type boundary. The destination
folder must already exist. The basename of the uploaded filename is used.
The effective limit is enforced server-side (oversized multipart input returns
`413`; the service can reject invalid size with `400`).

Uploads do not overwrite existing files; moves reject an existing destination,
moving into self, and a missing destination parent. Conflicts are not permission
to delete the destination. After an uncertain write, inspect the relevant directory
before offering another action. Refresh source/destination listings after success.
Download success includes `Content-Disposition: attachment`; read it as bytes,
not JSON, and release any temporary browser object URL after use.

## File deletion, protected extensions, and trash

File deletion is a separate flow from permanent project deletion. It requires
`projects.files.delete` and sensitive project scope. Deletion, confirmation,
reconciliation, and restore require READY and an active project; metadata lists
do not imply the same readiness gate.

All suffixes below follow `/api/v1/projects/:id`:

| Method and suffix                                          | Request                                                          | Success                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `GET /protected-file-types`                                | None                                                             | `200`: rule array, extension ascending              |
| `POST /protected-file-types`                               | `{ "extension": ".env" }`                                        | `201`: created/existing normalized rule             |
| `PUT /protected-file-types/:typeId`                        | `{ "extension": ".key" }`                                        | `200`: updated rule; creator owner only             |
| `DELETE /protected-file-types/:typeId`                     | None                                                             | `200`: `{removed:true}`; creator owner only         |
| `POST /files/delete`                                       | `{ "operationId": "<client UUID>", "path": "drafts/readme.md" }` | `201`: confirmation-required or trashed result      |
| `POST /files/delete-confirmations/:confirmationId/confirm` | No body                                                          | `201`: trashed result                               |
| `GET /file-operations`                                     | None                                                             | `200`: latest 100 operations, newest first          |
| `GET /file-operations/:operationId`                        | None                                                             | `200`: retained operation                           |
| `POST /file-operations/:operationId/reconcile`             | No body                                                          | `201`: inspected/reconciled operation; no file move |
| `GET /trash`                                               | None                                                             | `200`: ACTIVE item array, newest first              |
| `GET /trash/:trashId`                                      | None                                                             | `200`: retained restore/expiry outcome              |
| `POST /trash/:trashId/restore`                             | No body                                                          | `201`: `{restored:true,path}`                       |

Protection rules are project-scoped and normalized to lowercase with a leading
dot; input boundary whitespace is trimmed and maximum input length is 64. Rules
contain `{id,projectId,extension,createdById,createdAt,updatedAt}`. Appending an
existing normalized extension preserves the original rule and attribution.
Removing a rule does not delete a file. A directory containing protected file
types also requires confirmation.

Generate and retain `operationId` before deletion. Interpret the `201` body using
the literal true discriminator:

```json
{
  "operationId": "77777777-7777-4777-8777-777777777777",
  "confirmationRequired": true,
  "confirmationId": "88888888-8888-4888-8888-888888888888",
  "expiresAt": "2026-10-22T05:05:00.000Z"
}
```

```json
{
  "operationId": "77777777-7777-4777-8777-777777777777",
  "trashed": true,
  "trashId": "99999999-9999-4999-8999-999999999999",
  "path": "drafts/readme.md",
  "expiresAt": "2026-11-21T05:00:00.000Z"
}
```

The first body means no successful deletion yet. Confirm only after the user
accepts the protected-file warning. Confirmation expires after five minutes and
is invalidated by changed file evidence; the API rechecks it. Trash retention is
30 days at creation; use the returned `expiresAt`, not a client-invented deadline.

Operation readback contains `{id,projectId,kind:"DELETE",path,state,result,errorCode,
createdAt,updatedAt}`. `result` is null or a historical result of the shapes above.
States are `AWAITING_CONFIRMATION`, `PREPARED`, `COMPLETED`, `FAILED`, `NEEDS_REPAIR`.
After response loss or `FILE_OPERATION_UNRESOLVED`, read the **same** operation;
use reconciliation when appropriate. Do not issue a fresh identity for the same
uncertain path. A failed/unresolved operation is not proof its original path is
safe to delete again.

Trash list rows contain `{id,projectId,originalPath,isDirectory,deletedById,status,
expiresAt,createdAt,restoredAt,purgedAt}`. The list selects ACTIVE rows even when
expiry has passed and cleanup has not run: ACTIVE is not a restorability guarantee.
Outcome lookup additionally retains statuses `PREPARED`, `NEEDS_REPAIR`, `FAILED`,
`RESTORED`, `PURGED`, `PURGE_FAILED`, and includes `nextAction: NONE | REVIEW_OUTCOME`
and `executions`. Each execution has `{id,action,state,errorCode,createdAt,finishedAt}`;
action is RESTORE/PURGE, state is STARTED/UNKNOWN/REJECTED/RESTORED/PURGED.
Outcome lookup uses `originalPath`; the restore success body uses `path`.

Restore never overwrites a replacement destination. Regular files and supported
local same-volume Windows NTFS directories can be restored; unsupported runtime,
volume, or reparse cases fail closed, including `FILE_RESTORE_UNSUPPORTED`.
After `409` or `503 FILE_TRASH_OUTCOME_UNKNOWN`, read `/trash/:trashId` and review its
executions/nextAction; do not replay uncertain filesystem work. A completed restore
can return historical success on a later request. There is no user-facing purge
endpoint here. Refresh listings and retained outcomes after successful actions.

## Archive projects with retained context

Archival is the retention action for a project with history/content. Require
`projects.archive` and current creator ownership. Send:

```http
POST /api/v1/projects/11111111-1111-4111-8111-111111111111/archive
Content-Type: application/json
If-Match: "0"
```

```json
{ "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
```

Use `archiveRevision` from the project snapshot for the quoted `If-Match` value.
The header is required: missing is `428 REVISION_REQUIRED`, malformed is
`400 REVISION_INVALID`. Success is `200`:

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "actorId": "44444444-4444-4444-8444-444444444444",
  "revision": 1,
  "archivedAt": "2026-10-22T06:00:00.000Z",
  "createdAt": "2026-10-22T06:00:00.000Z"
}
```

After a lost acknowledgment, an identical request ID with the **original** revision
can return the recorded result while the owner remains authorized. Preserve both;
do not reread the new revision and substitute it into a retry of that identity.
On conflicting identity/revision, preserve input and inspect current state.

Archive retains files, membership, tasks, deadlines, and history. Refetch active
and archived lists after success. There is no restore/unarchive endpoint, and PUT
settings cannot clear archival.

Archive may return `409` for pending deletion/file operations, unfinished callbacks,
initialization that has not safely settled, or workspace execution that is active
or stop-unconfirmed. The execution restriction can include other workspace sessions
because legacy directory context is uncertain. Show the conflict; do not infer
that a terminal status or elapsed time proves writers have stopped.

## Permanent deletion of a proven empty project

Deletion must prove the project has no retained context. A nonempty description,
applied template, tasks/workflow links/history, initialization attempts, session
history/context, file-operation/trash history, unsettled work, or directory contents
can block deletion with `409`. Default board columns and the initial creator
membership alone do not constitute content. Unsafe/missing/unreadable paths also
block the emptiness check. Do not offer “clear everything first” as a workaround;
use archival for retained context.

With `projects.delete`, an owner or member can request deletion; final approval
and token entry belong to the creator owner. The owner must have a verified OPEN
Telegram account and the bot must be configured for token delivery. All suffixes
below follow `/api/v1/projects/:id`:

| Method and suffix                                    | Request                                                           | Success                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /deletion-requests`                            | No body                                                           | `201`: deletion request                                             |
| `POST /deletion-requests/:requestId/approve`         | No body; owner only                                               | `201`: updated request and preflight outcome                        |
| `POST /deletion-requests/:requestId/active-sessions` | `{ "action": "WAIT" }` or `{ "action": "INTERRUPT" }`; owner only | `201`: `{action,activeSessions:[{id,status}]}`                      |
| `POST /deletion-requests/:requestId/cancel`          | No body; owner or requester                                       | `201`: cancelled request                                            |
| `POST /deletion-requests/:requestId/confirm`         | `{ "token": "<owner Telegram token>" }`; owner only               | `201`: `{deletionAuditId,status,projectRemoved}`                    |
| `GET /deletion-requests`                             | None                                                              | `200`: `{projectRemoved,requests,audits,limit}`; latest 100 of each |
| `GET /deletion-requests/:requestId`                  | None                                                              | `200`: `{projectRemoved,request,audit}`; nullable request/audit     |

The request ID is generated by the server for this flow. Save it before subsequent
actions; after a lost initial response, inspect history rather than requesting
another deletion. A deletion-request response contains `id`, `projectId`, `requestedById`,
`ownerId`, `status`, `nextAction`, `requestedAt`, nullable `approvedAt`,
`tokenExpiresAt`, `activeSessionAction`, `completedAt`, `cancelledAt`, `failureCode`,
plus `tokenExpired`, `tokenLocked`, `activeSessions`, and `tokenSent`.
`failureCode` is null or `DELETION_FAILED`; active session summaries contain only
ID and QUEUED/RUNNING/PAUSED status. `tokenSent` reports delivery success for that
mutation only; a readback with false does not prove no token was ever sent.

| Status / `nextAction`                                  | UI action                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `PENDING_OWNER_APPROVAL` / `OWNER_APPROVAL`            | Owner may approve; member requester waits                                                                            |
| `AWAITING_ACTIVE_SESSIONS` / `RESOLVE_ACTIVE_SESSIONS` | Owner runs approval/preflight; if tracked sessions are reported, deliberately chooses WAIT or INTERRUPT and rechecks |
| `AWAITING_TOKEN` / `CONFIRM_TOKEN`                     | Owner enters the latest Telegram token                                                                               |
| `AWAITING_TOKEN` / `REISSUE_TOKEN`                     | Token expired/locked; owner deliberately calls approve to reissue                                                    |
| `DELETING` / `WAIT`                                    | Reconcile current request/audit; do not repeat confirmation                                                          |
| `FAILED` / `REVIEW_FAILURE`                            | Stop and review retained failure state                                                                               |
| `COMPLETED` or `CANCELLED` / `NONE`                    | Display the terminal outcome                                                                                         |

Token lifetime is ten minutes; five failed token attempts lock confirmation until
reissue. Keep the token in memory, never URLs/storage/logs. Emptiness checks run
again before destructive effects, and can reject before any interruption or token
attempt. The active-session branch is a server contract, not permission to bypass
context retention. Do not automatically interrupt sessions or resend tokens.

Confirmation success is not necessarily purge completion. Audit status is
`PURGE_PENDING`, `PURGED`, or `PURGE_FAILED`; audit records contain
`id,projectId,requestId,status,nextAction,failureCode,createdAt,completedAt`.
`nextAction` is WAIT/NONE/REVIEW_FAILURE; failureCode is null or PURGE_FAILED.
Read by the known request after timeout, confirmation response loss, or project
detail disappearance. Durable readback can remain available after the project row
is removed, scoped to the saved owner/requester workspace and current delete grant.
`404` from project detail alone does not establish purge success. The history cap
is not complete-history pagination; known request IDs remain independently readable.

## Errors, loading, and stale state

Most failures use the Nest envelope below; `message` can be a string or validation
array. Some structured domain errors add `code`, `action`, `field`, and an operation
ID or reconciliation context; some provide only code/message. Do not require a
domain code on every failure or match raw message text as a universal discriminator.

```json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}
```

| Result                                     | Frontend response                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`                                      | Keep form input, show validation; check exact field names, values, paths, UUIDs, and cursors                                                 |
| `401`                                      | Restore/re-authenticate through the authentication contract; do not automatically replay writes                                              |
| `403`                                      | Refresh authorization/scope and disable unavailable actions; do not treat as an empty list                                                   |
| `404`                                      | Check transport allowlist and resource scope; absent/inaccessible resource is not proof an uncertain mutation did not commit                 |
| `409`                                      | Handle the operation's directory, lifecycle, identity, revision, file evidence, or history conflict; reread before another deliberate action |
| `413`                                      | File exceeds effective upload limit; preserve destination and offer a smaller selection                                                      |
| `428`                                      | Supply the required quoted archive revision, or move legacy CLEAR to keyed creation as indicated                                             |
| `503`, other `5xx`, timeout, response loss | Show unavailable/unknown outcome, retain useful form state and operation IDs, and follow that operation's readback flow                      |

Do not turn read failures into `[]`, successful deletion, anonymous state, or a new
project. For reads, allow controlled retries without discarding the last known
data as if it were current. Abort/ignore responses belonging to a previous project,
account, tab filter, or candidate query. After mutation success, refetch only the
affected authorized views; a scalar response is not a full detail snapshot.

## Frontend acceptance checklist

- List and detail through browser sessions; authenticated empty state versus
  forbidden/unavailable/disabled proxy states; logout clears protected state.
- Active/archive filters, all four setup statuses, `archivedAt` independent of
  status, latest initialization arrays, omitted rosters, and factual `isMember`.
- UI actions require both the appropriate capability and relationship/lifecycle;
  a role label, public reader, or read-all grant alone does not enable mutations.
- Before enabling management screens, implement/test their transport explicitly,
  including selectors, multipart, binary downloads, and initialization SSE.
- Creation validates names/booleans, preserves the original request ID on lost
  responses, handles UNRESOLVED and directory choices, and never auto-replays CLEAR.
- Settings clear description correctly, preserve false, and retain/refetch
  relations after scalar responses.
- Member picker handles null names, literal search, all sort/filter modes, cursor
  reset, changed totals, stale responses, and eligibility changes before assignment.
- Initialization distinguishes job registration, progress, failure, retry, and
  missing-enqueue recovery; event reconnects deduplicate and reconcile gaps.
- File selection uses current limits; upload/move conflicts preserve destinations;
  downloads use binary handling; unsupported symlinks remain non-actionable.
- Protected deletion needs explicit confirmation; operation IDs survive response
  loss; expired trash and unknown restore outcomes do not trigger blind retries.
- Archival preserves identity/original revision on retry and refreshes both lists;
  there is no invented unarchive control.
- Contextual deletion is blocked in favor of retention; empty-project deletion
  follows owner approval, token state, known request readback, and purge outcome.

## Related project views and contract sources

Project task boards, human collaboration, shared task content, articles, and coding
sessions have separate contracts. Membership in one project is not an inferred
link to a task/session or authority to read execution history. Use these documents
for those tabs rather than treating every route below `/projects` as the same API:

- [Human task reads and archival](../project-archive-human-task-contracts.md),
  [collaboration](../human-task-collaboration-contracts.md),
  [board statuses](../task-board-status-contracts.md),
  [shared tasks](../shared-human-task-contracts.md), and
  [shared content](../shared-task-content-contracts.md).
- [Project/session/task identity](../project-session-task-identity-contracts.md)
  and [session project queries](../project-session-query-contracts.md).
- [Article drafts](../article-private-draft-contracts.md) and
  [canonical publication](../article-canonical-publication-contracts.md).

The current controllers, DTOs, service projections, and Prisma enums are the source
of truth. This guide cross-checks `src/projects/`, the browser proxy allowlist in
`src/browser-sessions/browser-session.controller.ts`, `src/auth/auth.guards.ts`,
`src/openapi/revision.ts`, and the department/template selector controllers.
Machine-readable API artifacts live in [OpenAPI](../api/openapi.json) and the
[local Postman collection](../api/postman-current-local.collection.json); they are
snapshots and do not prove deployment or browser transport availability.

Additional behavior and regression evidence:

- [Creation readback](../project-creation-readback-contracts.md) and
  [initial-enqueue recovery](../project-enqueue-recovery-contracts.md).
- [Response shapes](../task-project-response-contracts.md),
  [viewer membership](../project-viewer-membership-contracts.md),
  [member picker](../project-member-picker-contracts.md), and
  [current mutation authority](../project-mutation-authority-contracts.md).
- [Initialization event replay](../initialization-event-readback-contracts.md),
  [file/template contracts](../file-template-contracts.md),
  [file deletion journal](../file-deletion-journal-contracts.md),
  [trash recovery](../file-trash-recovery-contracts.md), and
  [project deletion readback](../session-project-deletion-contracts.md).

Historical verification statements in those documents describe their own runs.
This documentation update does not establish production enablement, execute live
filesystem actions, or publish changes to a hosted Postman workspace.
