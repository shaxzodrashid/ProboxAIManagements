# Bounded chat group metadata — October 14

Authorized scope: any current OPEN human account may create group metadata, read
its created metadata and recover a creation acknowledgment. No additional global
create permission. This implements a foundation only: no messages, memberships,
participant access, lists, invitations, trusted-admin powers, history, agent
principals or ownership transfer. Parent owns Space checklist updates; no complete
conversation checklist item is claimed solely from this batch.

## HTTP contract

| Endpoint                                | Result                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST `/chat-groups`                     | 201 `{requestId, group}`; required UUIDv4 requestId and trimmed plain-text name of 1–120 characters |
| GET `/chat-groups/creations/:requestId` | 200 frozen initial creation outcome, scoped to authenticated creator                                |
| GET `/chat-groups/:groupId`             | 200 current metadata, scoped to authenticated creator                                               |

Group projection is exactly `{id, name, creatorId, ownerId, createdAt}` using existing
camelCase DTO conventions. Initial owner and creator are the authenticated human;
neither is caller-selectable. All query selectors and extra body properties are
rejected. Every route is no-store, requires current OPEN authentication and checks
persisted account/workspace again in its transaction. Missing and foreign metadata
return opaque 404. Role labels, global permissions and shared workspace give no
creator-read bypass. Metadata is platform scoped per the approved chat direction;
an active creator retains metadata/readback after changing its current workspace.
That does not grant access to another workspace or any conversation history.

Names are literal plain text; clients must render them as text. UUID case and outer
name whitespace normalize before hashing. Request IDs are immutable per creator;
different creators may use the same request ID independently. Same key/input
replays the same initial outcome; changed name returns 409 GROUP_REQUEST_CONFLICT.
After transport loss or OPERATION_OUTCOME_UNKNOWN, read the receipt or retry the
same key/input. POST replay also returns 201. Never generate a new key merely to
recover an uncertain acknowledgment.

## Persistence and migration

Migration `20261014020000_chat_group_metadata` adds two empty tables and indexes
inside BEGIN/COMMIT. It does not rewrite, backfill or split existing records, add
permissions or grants, or change account lifecycle. Restrict foreign keys preserve
creator/owner provenance and receipts. Future retention/erasure policies must
explicitly handle these references; this batch adds no physical-delete endpoint.

ChatGroupCreation stores input hash and frozen name/initial owner/time separately
from mutable group metadata. Its creator/request primary key does not depend on
future owner changes. Creation uses the existing workspace lifecycle lock, rechecks
the current account, and holds a creator/request advisory transaction lock. Group
and receipt inserts commit atomically. Read transactions use repeatable-read so
authorization and projection share a snapshot. No filesystem, external service,
provider execution, session credential or live setting is involved.

## Verification and exact files

The resumed full regression run passed **854 tests across 50 suites**. After that
run, the existing recovery test was strengthened to inject an acknowledgment
failure after the real transaction commits; its focused rerun passed **32/32**.
There were no runtime changes after the full run. Independent final read-only
review found no remaining actionable findings and confirmed the recovery evidence
gap was resolved. Real isolated PostgreSQL
HTTP tests cover zero-permission creation, narrow projection, durable replay/lost
acknowledgment, concurrent retries, changed-input conflict, frozen receipts,
same/foreign-workspace isolation, role-label bypass rejection, inactive/anonymous
credentials, post-guard lifecycle/workspace changes, workspace-move recovery,
forged fields, validation, rollback and generated OpenAPI schemas.

Upgrade fixtures snapshot every existing application table before migration and
compare all row contents afterwards; new metadata tables must remain empty. Only
preserved localhost port 55439 databases are authorized by the test fixture guard.
No production migration, staging, commit, push or deployment is performed.

Final serial quality checks passed: TypeScript, ESLint (zero warnings), repository
TypeScript formatting and Nest build. Prisma schema validation passed; both
isolated databases report all 28 migrations applied. Main database schema diff is
empty. Upgrade database diff reports only five retained historical fixture tables:
`isolated_archive_upgrade_evidence`, `isolated_board_upgrade_evidence`,
`isolated_checklist_deadline_evidence`, `isolated_human_upgrade_evidence` and
`isolated_priority_upgrade_evidence`. They are deliberately preserved; no application
schema differences were reported. The additive migration's earlier upgrade check
compared every preexisting application row and passed.

Cleanup was confirmed after verification: no repository Jest/TypeScript/lint/build
or Prisma verification processes remained, and pg_ctl confirmed this exact
isolated cluster stopped. Databases and historical evidence are preserved.
Branch remains main at `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`;
the user's staged patch fingerprint is unchanged
(`fa085010db24658b91b8360a0ce1fbd1e9bc20bb79d057183cc36a6ea753db2d`).
The metadata changes remain unstaged. No blocker remains for this bounded batch;
the conversation umbrella remains partial pending the policies below.

Files in this batch:

- `src/groups/groups.controller.ts`, `groups.dto.ts`, `groups.service.ts`, `groups.module.ts`
- `src/app.module.ts`, `src/openapi/api-docs.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261014020000_chat_group_metadata/migration.sql`
- `test/chat-groups.http.spec.ts`
- `test/fixtures/chat-group-upgrade-before.sql`, `chat-group-upgrade-after.sql`
- `Docs/chat-group-metadata-contracts.md`, `Docs/conversation-foundation-decisions.md`, `README.md`

Pending decisions stay with the parent: trusted-admin appointment/delegation,
structured DM foundation/invitation authority, history admission selection and
rejoin/retroactive effects, persistent agent identity/provisioning and
ownership/credential revocation policies. Subsequently approved on October 14:
active employee means a current OPEN account belonging to the workspace; default
new-member history is None, and 100/300 counts pre-join messages separately per
forum topic, with All available. These decisions do not add history access to this
metadata batch. No remaining policy choice is inferred.
