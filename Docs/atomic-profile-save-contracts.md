# Atomic Profile Save

Available locally since 0.3.0-dev.9. Backend implementation and PostgreSQL tests
do not imply frontend/Figma integration or deployment.

## Additive API

All paths below have the application's `/api/v1` prefix. Human access-token self
only, including OPEN employees with zero workspace permissions. Fresh persisted
owner, lifecycle and workspace checks apply, including receipt reads/replays.
No caller-selected owner, role bypass, agent principal or credential is supported.
All responses are `Cache-Control: no-store`; unknown body/query selectors reject.

- `GET /users/me/profile/edit`: one Repeatable Read snapshot of `profile`,
  `audiences`, `status: {availability, revision}` and aggregate `revision`.
  Reading absent status/revision does not create history or choose a default.
- `PUT /users/me/profile/changes`: existing supported profile fields, required
  `audiences` array (empty allowed), UUIDv4 `requestId`, integer
  `expectedRevision` from edit read and optional `availability`.
  Omission retains; null clears supported nullable fields. Availability is
  AVAILABLE/AWAY/BUSY/null and publishes equally to everyone only on commit.
- `GET /users/me/profile/operations/:requestId`: minimal private historical
  acknowledgment `{requestId, expectedRevision, revision, createdAt}`. The Save
  returns the same shape. It proves that command committed, not current values.
  Reread `/edit` for the current generation and content.

The new command uses an explicit body expectedRevision and application 409
conflicts. It does not reinterpret existing status If-Match tokens or silently
change its existing 428/400/409 contracts. Missing/malformed new body revisions
are validation400, stale generation is409 PROFILE_SAVE_REVISION_CONFLICT, changed
request identity reuse is409 PROFILE_SAVE_REQUEST_CONFLICT, unknown persistence
failure is sanitized503 PROFILE_SAVE_UNAVAILABLE. Authentication401 is separate.

## Atomicity and lock order

One transaction owns supported names/bio/birthday, supplied complete audience
replacements, optional manual availability, its human history, aggregate revision
and root receipt. A final receipt failure rolls everything back. Contacts and
aliases remain separately committed explicit actions; uploads, custom status text,
emoji/symbols, expiry, username/phone, lifecycle, membership and permissions are
outside the command. Legacy STATUS audience metadata remains inert for availability.

The root command locks workspace, then owner, then dependent policy/status rows.
All shipped writers share workspace admission; legacy privacy/status acquire
the owner write lock through revision triggers after their dependent-row writes.
Legacy profile Save and per-field privacy now acquire the workspace lock before
their existing Serializable transactions write; PATCH self also locks workspace.
Standalone status already locks workspace. The root command uses Read Committed
with workspace and owner row locks so an exact retry waiting on an earlier Save
sees its committed receipt. The owner lock also coordinates covered direct User
writes. No automatic transaction retry or stale rebasing occurs. Concurrent direct
administrative SQL spanning dependent rows in another order may fail/deadlock and
must reconcile; application roles must not disable triggers. No network side effect
or user-review wait occurs inside this transaction.

## Aggregate generation and writer audit

User.profileRevision is an opaque monotonic generation, not an edit count. Database
triggers advance it for UPDATE statements naming fullName/firstName/lastName/bio/
birthDate, and inserted/updated/deleted audience policies, account/workspace
recipients and ManualProfileStatus rows. Explicit equal-value writes count.
Each accepted root command also advances it, even an empty Save. One command may
advance it multiple times; clients must use the returned token, never add one.
The separate status revision and existing mutation receipts keep their old meaning.

Covered audited writers: AccountsService PATCH/helper; legacy ProfilePrivacyService
Save and field replace; ManualStatusService standalone/helper; bootstrap-user and
seed fullName updates; direct policy/recipient/status writes. Creation initializes
the protocol baseline. Runtime user creation/register does not edit an existing
profile. Authentication/Telegram, lifecycle and workspace authorization revisions
are not profile generations. Contacts/aliases do not advance it. A policy in CONTACTS
mode still evaluates its separately changing Contacts set at read time.

All deployed writers see triggers once the migration is installed. Legacy clients
remain compatible and invalidate new drafts, but have no stale-form precondition of
their own. Old endpoints cannot be combined into an atomic status/profile Save by
HTTP ordering or Promise.all. Transaction-aware helpers must be called only within
an authorized owning transaction; they do not activate delegated agents.

## Receipts and unknown outcomes

The root namespace is separate from standalone status request IDs. It records owner,
human actor, workspace, original revision, SHA-256 of normalized intent, resulting
generation, timestamp and optional randomly generated child status request ID.
It stores no bio, birthday, audience recipient snapshot or full response body.
The intent hash remains private metadata, not encryption or a public content proof.
Receipts last with the account and cascade on account deletion; this creates no
public profile history API or new broader history-retention policy.

Normalize names using existing DTO rules, order recipient sets and policy fields
canonically, preserve omitted versus null, and bind the original expected revision.
Exact root replay checks fresh authority, returns the old acknowledgment and writes
nothing, even after a newer edit. Same UUID with different intent conflicts. Child
status history shares the root transaction; it is never mistaken for root success.

After timeout/abort/503 keep the original request ID, payload and expected revision;
read that operation or retry unchanged. Do not generate a new command, compensate
with old values, or infer success from matching current values. A receipt404 while
the first command is in flight is not proof of rollback. A stale conflict preserves
the draft for explicit reconciliation; never silently replace its base revision.

## UI contract and excluded activation

Focused editor Done stages local data. Main Save changes submits exactly one root
command; pre-submit Cancel discards unsent changes. After dispatch, abort/closing
is not a rollback guarantee. A separately labelled Save status action can still
use the standalone endpoint. Never call that endpoint as the main form's Done.
See [UI handoff](backend-ui-handoff.md) for required states and wiring.

Agent identity, exact approvals, permission-loss hooks, agent attribution/history
and badge persistence remain inactive and require their own implementation and
review. An atomic human Save does not authorize any agent action.

## Migration and verification

Migration20261016020000 is additive: revision baseline0, private receipt table and
revision triggers. It does not rewrite/split legacy names, change availability,
backfill defaults/history, replace audiences or grant permissions. Existing status
revisions and receipts remain intact. Reverting to an old application binary can
retain the added schema/triggers; destructive schema rollback is not required.

Tests cover final-write rollback of every component, invalid recipients, concurrent
distinct drafts/exact retries, historical replay, lost acknowledgment, every covered
writer, omitted/null and set-order semantics, explicit equal/empty commands,
human/workspace/lifecycle/input boundaries, status compatibility, coherent reads
during an intervening commit and OpenAPI. Fresh migration, existing-data upgrade
preservation and Prisma model parity are verified separately in the isolated cluster.
