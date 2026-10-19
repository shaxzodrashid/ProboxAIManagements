# Approved Profile media and custom status — 18 October 2026

Approved by owner messages Sentinel_49e5cdbc9a7c81918d4c93a87b44d03c and
Sentinel_99201d533fcc8191a52cbe8535d728ca. This implementation supersedes the pending
status in the earlier proposal for the explicitly approved feature package.
All paths below are relative to `/api/v1`; deployment remains on hold.

## Custom status

Main atomic Profile Save accepts optional `customStatus`: omit to retain, null
to clear, or a complete `{text,emoji,expiresAt}` object with nullable fields.
Text is trimmed single-line plain text, at most **100 Unicode code points on API
writes**. PostgreSQL stores it as **VARCHAR(300)**; future/internal values through
300 are preserved without truncation and read DTOs document that storage capacity.
API attempts above 100 reject even though the database can hold 300. Emoji is one
validated Unicode emoji grapheme/sequence, not a single UTF-16 unit or an uploaded
icon. Text-only and emoji-only statuses are supported.

Expiry has no automatic default. A supplied RFC3339 instant with explicit offset
is normalized to UTC. A new Save must choose a future instant; exact committed
receipt replay remains valid after expiry. Text and emoji expire together without
changing shared Available/Away/Busy. Self reads retain the current stored value
and expose whether it is active so an expired draft can be edited deliberately.
Public reads return null for unset, expired or audience-hidden custom status.
STATUS audiences now control only custom text/emoji, never shared availability.
Existing directed Contacts, Custom membership/account sets and private absent
policy evaluation apply. No status history/public old-content API is created.

## Avatar staging and atomic publication

Uploads validate JPEG/PNG bytes and full decode, cap input at 5 MiB and normalize
to a square PNG no larger than 512px, without upscaling or original EXIF/GPS.
Decoder budgets are 16 million pixels / 8192px per dimension; normalized output
is bounded to 2 MiB. Animated/unsupported/malformed input rejects. Optional square
crop coordinates are validated after orientation; absent crop uses a centered
square. No original image is retained as a downloadable object.

An owner-only multipart upload uses a retained UUID request identity. It stages an
immutable account-owned asset without publishing or changing the existing photo.
Unpublished staged assets expire after 24 hours, explicitly returned to the client;
expired drafts require reupload and never remove the current photo. Exact retries
do not issue a second put. Readback reconciles matching stored-object evidence;
unknown outcomes remain observable and are never called a confirmed failed write.

Main Profile Save gains optional `avatarAssetId`: omit to retain, null to remove,
or an owned staged asset ID to publish. Pointer, supplied audiences, content,
availability, revisions and minimal human receipt commit together. A failed Save
retains the current image. Old references become unavailable after a committed
replacement/removal. Replay acknowledges the historical Save without resurrecting
an old image. Crop/Done stage locally; one main Save publishes.

Private preview requires current OPEN ownership. Public image delivery checks the
current OPEN account, current asset reference and current AVATAR viewer audience,
including another check after storage fetch. Hidden, absent, removed and stale
references have the same unavailable response. Return normalized PNG with no-store
and nosniff; never raw object keys, original names, hashes or direct storage URLs.
Public profile image metadata is null when unavailable. Existing image bytes
already delivered cannot be recalled; later requests recheck current access.

Reuse existing S3/MinIO connection conventions through an avatar-specific adapter,
with an explicitly configured preprovisioned private avatar bucket. No bucket,
credential, ACL or live setting is created here. Tests substitute isolated object
storage. Remote I/O stays outside account transactions. Avatar-specific cleanup
rechecks references and retires immutable keys durably; the template cleanup table
and worker are not reused for avatar keys. Pending uploads with uncertain evidence
remain fenced rather than being deleted merely because a timer elapsed.

## Preserved boundaries

No username/phone, role, lifecycle or membership writes; no agent principal or
approval bypass. Existing human actor attribution, root/standalone availability
receipts, audience rules and stale-draft handling remain intact. New fields join
the aggregate all-writer revision protocol. Historical content is not backfilled
or automatically published. Schema/migration and tests precede readiness claims;
this document is the implementation contract, not deployment evidence.

## Routes and operational boundary

| Route                                                | Purpose                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /users/me/avatar-uploads`                      | Multipart `requestId`, `file`, optional complete `cropX/cropY/cropSize`; 201 current asset receipt |
| `GET /users/me/avatar-uploads/operations/:requestId` | Owner-only current upload reconciliation                                                           |
| `GET /users/me/avatar-uploads/:assetId/content`      | Owner-only ready preview/current image                                                             |
| `DELETE /users/me/avatar-uploads/:assetId`           | Retire an unpublished ready draft; active/uncertain conflicts                                      |
| `GET /profiles/:accountId/avatar/:assetId`           | Current viewer-authorized normalized image                                                         |
| Existing root edit/Save/operation routes             | New fields join existing aggregate revision and whole-Save receipt                                 |

All new routes reject query selectors. Public profile metadata now contains
nullable avatar/customStatus projections. Private image routes require a current
OPEN human owner; image access is rechecked after storage fetch. Image endpoints
serve PNG. The basic self-profile response and authentication scopes stay compatible.

`MINIO_AVATAR_BUCKET` must name an existing private bucket before media use.
Connection/credentials reuse the existing MINIO settings; `MINIO_AUTO_CREATE_BUCKET`
does not apply to this adapter. The implementation makes no bucket/ACL changes,
uses no object URL and disables transport retries for immutable single-attempt
uploads. Missing configuration fails media operations with 503. No live MinIO
integration or bucket privacy verification has been performed in this checkout.

### Existing storage configuration inspection

The existing MinIO/S3 integration supports the avatar operations without requiring
new credentials or an ACL change in application code. Reuse is conditional on an
already existing private bucket and the existing principal already having the
needed access. Template-bucket access alone does not prove avatar-bucket access.
Do not repurpose the template bucket or broaden its policy by assumption.

| Runtime setting                        | Exact requirement                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MINIO_AVATAR_BUCKET`                  | Existing private bucket name; mandatory with no default and no automatic creation.                                                   |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Reuse existing authorized storage credentials through the existing secret/environment layer; never put values in docs or image URLs. |
| `MINIO_ENDPOINT`                       | Existing reachable S3/MinIO endpoint. Code fallback is loopback port 9000, not proof of deployment configuration.                    |
| `MINIO_REGION`                         | Existing region; code fallback `us-east-1`.                                                                                          |
| `MINIO_FORCE_PATH_STYLE`               | Existing endpoint convention; defaults true.                                                                                         |
| `MINIO_AUTO_CREATE_BUCKET`             | Ignored by avatar adapter; no avatar provisioning or ACL operations occur.                                                           |

The current laptop process has none of these MinIO variables set and the checkout
has no `.env`. `docker-compose.yml` defines a MinIO server and data volume but no
avatar bucket provisioning. `.env.example` leaves the avatar bucket unset. These
observations concern this checkout/process only, not production configuration.
No live connection, bucket inventory, credential readout or policy change was used.

Before runtime enablement, an operator must verify that the chosen existing bucket
is private and that the existing principal supports PutObject, HeadObject,
GetObject and DeleteObject for `accounts/<ownerId>/avatars/<assetId>.png`, including
SHA-256 object metadata and bounded PNG bodies. Missing objects must be distinguished
from access/transport failures: a 403 is unavailable, never proof of absence.
If no such bucket/access already exists, provisioning or expanded access requires
a separate decision and dependent live integration stays blocked. No new credential
or policy grant is selected here.

`GET /health/ready` verifies PostgreSQL and template storage, not the avatar bucket.
Template storage has its own optional create-bucket behavior; its green status is
not avatar readiness evidence. A future authorized read-only avatar preflight must
use the intended avatar bucket and existing principal directly, without invoking
template auto-provisioning. Real upload/read/delete verification remains pending.

The cleanup worker polls every minute, handles at most 20 due assets and retries
failures with bounded backoff. It durably claims deletion before remote I/O and
never retires a referenced ACTIVE asset. An UPLOADING row with no matching visible
object remains fenced, including after staging expiry: a clock does not prove a
pending put has stopped. A crash between allocation and put can therefore leave
an unresolved private receipt. No automatic unsafe put replay/purge is implemented.
Physical account deletion with retained asset receipts requires a future explicit
purge policy; the owner FK deliberately restricts deletion.

## Migration and changed-file manifest

`20261018010000_profile_media_status` is additive: four nullable User columns,
an initially empty asset table, bounded image constraints, owner/reference guards
and extension of the existing all-writer content-revision trigger. It does not
split names, backfill historical content or publish an audience. Existing writers
continue advancing aggregate revisions. The migration is transactional but takes
table locks; production scheduling remains outside this local authorization.
An old binary can leave these additions in place. Do not drop asset state while
object writes or cleanup may still be in flight; any destructive rollback needs
its own reconciliation and reviewed migration.

Exact feature increment files (some already contained preserved earlier edits):

```text
.env.example
package.json
pnpm-lock.yaml
prisma/schema.prisma
prisma/migrations/20261018010000_profile_media_status/migration.sql
src/accounts/custom-status.ts
src/accounts/profile-avatar-domain.ts
src/accounts/profile-avatar-image.ts
src/accounts/profile-avatar-storage.ts
src/accounts/profile-avatar.dto.ts
src/accounts/profile-avatar.controller.ts
src/accounts/profile-avatar.service.ts
src/accounts/accounts.module.ts
src/accounts/profile-save.dto.ts
src/accounts/profile-save.service.ts
src/accounts/profile-save.controller.ts
src/accounts/profile-privacy.service.ts
src/accounts/profile-privacy.dto.ts
src/accounts/profile-picker.dto.ts
src/accounts/public-profile.controller.ts
test/profile-media-status.http.spec.ts
test/profile-image-validation.spec.ts
test/profile-avatar-storage.spec.ts
test/profile-avatar-failures.http.spec.ts
test/profile-picker.http.spec.ts
test/manual-status.http.spec.ts
Docs/profile-media-status-contracts.md
Docs/profile-avatar-status-proposal.md
Docs/profile-gap-review-20261018.md
Docs/authorization-read-contracts.md
Docs/backend-ui-handoff.md
Docs/api/README.md
Docs/api/openapi.json
Docs/api/endpoints.json
Docs/api/postman-operation-docs.json
```

Existing dirty names/profile, authorization, session-disclosure, publication and
other user work is retained. No shared checklist, external Postman collection,
commit, push, deployment or production database is changed by this increment.

## Verification and acceptance — 18 October 2026

Final full regression: **1,120 tests / 59 suites passed**, including 36 new
HTTP/PostgreSQL media/status cases and nine image/storage primitive cases.
Coverage includes zero-grant human self access, forbidden selectors, lifecycle,
foreign ownership, audience revocation during fetch, directed Contacts, dynamic
Custom membership, actual PNG/JPEG decode/crop/orientation, pixel/size budgets,
Unicode API 100/database 300, emoji sequences, expiry, concurrent upload/Save,
lost acknowledgments, final-receipt rollback, stale all-writer revisions,
database ownership guards and cleanup retry/current-image protection.
The storage adapter is tested with mocked S3 commands and bounded streamed bytes;
HTTP tests use isolated PostgreSQL and a controlled object-store substitute.

Typecheck, lint, format, build, release check and `git diff --check` pass.
Prisma schema validation and migration status pass with all 33 migrations on
`127.0.0.1:55439/profile_test`; no other database receives this migration.
Source export and request-template verification cover 165 operations from 26
controllers, including PNG response media types and conflict contracts.
Postman OpenAPI syntax lint reports no issues. Deployment Bash syntax/ShellCheck
pass using the already available temporary ShellCheck 0.11.0 executable.
All 38 mocked deployment scenarios pass without real services, network updates,
production credentials or migrations. The isolated test cluster was stopped after
verification; its data directory is retained. Protected README and delegation
assessment hashes remain unchanged from the pre-increment records.

No whole shared checklist item is marked closed by this laptop increment.
Avatar/custom-status portions of API02/API03/API10/API12 have local implementation
and regression evidence; the parent must reconcile exact Page acceptance criteria.
Frontend persistence/accessibility, deployment, and live private object-storage
configuration/delivery remain unverified. Username/phone edits, session revocation,
discussion models and other undecided policies remain outside this increment.
The staging TTL applies only to unpublished assets; API text writes cap at 100
while longer stored values through 300 remain readable without truncation.

### Follow-up avatar read availability correction

Failure injection reproduced seven cases returning generic 500 for an avatar
database read outage. Owner checks, upload receipt reads, preview metadata and
public asset reads now share the existing sanitized `PROFILE_AVATAR_UNAVAILABLE`
503 boundary with transactional operations. Existing HttpException outcomes,
including authoritative 404, remain intact. No failed read becomes anonymous,
an empty image, a new upload, a proven rollback or authority to replay put.
Failure of the final dependency/access read suppresses fetched image bytes.

Exact follow-up files are `src/accounts/profile-avatar.service.ts`,
`test/profile-avatar-failures.http.spec.ts`, this contract and
`Docs/backend-ui-handoff.md`. No route, schema, storage setting, permission or
migration changes in this correction. Root status input remains 100, storage/read
capacity 300; the staged-avatar/main-Save flow is unchanged. Generated API
contracts already declare 503 and need no shape change for this implementation fix.

Follow-up verification: **177 tests / eight suites passed** (eight new HTTP
failure cases, nine image/storage primitive cases and 160 focused real-PostgreSQL
profile, atomic Save, picker, availability and authentication regressions).
The earlier 1,120-test full run predates this correction; it is not presented as
a new full-suite run. Typecheck, lint, format, build and `git diff --check` pass;
no schema change is needed.
The isolated database was restarted explicitly on loopback port 55439 for this
verification and stopped afterward. No live object storage was contacted.
