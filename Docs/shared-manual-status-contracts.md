# Shared manual availability

Local **0.3.0-dev.8**, not deployed. All routes below are relative to `/api/v1`.
The owner's16 October simplification selects one standalone manual status for
everyone, superseding audience-valued status, overlap priority and department
resolution. Existing design choices supply Available / Away / Busy; wire values
are `AVAILABLE`, `AWAY`, `BUSY`. No other choices or selected default are added.
Null means unset, not Available, Offline, unknown connection state or hidden status.

## HTTP and authority

| Route                                        | Contract                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/users/me/status`                       | Current OPEN human self, including zero workspace permissions; `{availability,revision}`. An absent record returns null/revision0 without writing.                                                                                                                      |
| PUT `/users/me/status`                       | Self only; quoted If-Match and `{requestId:UUIDv4,availability:choice-or-null}`. Explicit null clears. Required choice field; no owner, workspace, agent, privacy, custom text or symbol selector.                                                                      |
| GET `/users/me/status/operations/:requestId` | Current OPEN self only. Frozen mutation outcome for retry reconciliation; another owner's receipt is404.                                                                                                                                                                |
| GET `/profiles/:accountId/status`            | Public shared value for an OPEN account: exactly `{accountId,availability}`. Same value for anonymous, owner, same/outside-workspace viewers. Optional invalid authentication rejects rather than becoming anonymous. Missing and inactive accounts return the same404. |

Every route is no-store and rejects unknown query selectors. Human identity and
workspace are derived from the existing access-token guard and rechecked in the
service transaction. Role labels, body actor IDs or permissions do not select
another owner. Public read intentionally has global profile scope, like public
identity; it does not expose workspace, private profile, actor/history, timestamps,
online state or access grants. Status is an account-level profile value, not a
workspace-specific preference. Receipt workspaceId records the writing context;
receipts remain employee-owned, never another workspace's directory.

## Revisions, history and uncertain outcomes

Writes acquire the existing workspace lock before checking current owner state,
then compare the status revision. Existing-state writes additionally use a
revision compare-and-update. State/revision and an append-only application receipt
commit together. A successful unchanged save/clear is still an explicit human
action and advances one revision. The receipt stores prior and resulting value,
employee actor, workspace context, request ID, original/result revision and time.
Self operation readback returns `{requestId,availability,revision,actor,createdAt}`;
actor is explicitly `{kind:EMPLOYEE,id}`. No general history-list or public old-
value/actor disclosure is added.

UUID casing is normalized. Exact request ID, original revision and selected value
return the frozen receipt after fresh authority checks, without reapplying it.
Changed reuse409 and stale revision409 preserve saved state and the user's draft.
Missing revision428 and malformed/unknown/invalid input400 remain distinct.
Concurrent exact retries converge; different writes at one revision conflict.
Inactive authentication returns401; stale direct service ownership is denied.
Unknown database failure returns sanitized503 `MANUAL_STATUS_UNAVAILABLE`, which
does not prove rollback. Read the same operation or retry unchanged after a lost
response; never infer failure from receipt404 while a request may still complete.
Historical responses describe their original action, not current status.

Reads check authorization/current eligibility in a fresh repeatable-read snapshot.
A change committed after that snapshot is observed on a subsequent request; no
live stream, cache invalidation push or continuous-presence guarantee is implied.

## Privacy and compatibility

Existing STATUS audience records/picker options are retained as inert legacy
metadata for compatibility. They have no effect on this shared availability:
NO_ONE, Contacts or Custom neither hide nor vary it. DTO/OpenAPI and the new status
editor must state this explicitly. Saving status must not silently edit these
records. Other field audiences and independent privacy permissions remain intact.
Legacy profiles, public profile bodies, combined profile Save, Contacts and their
existing response shapes are unchanged. Existing policy APIs may still manage
legacy STATUS metadata; clients must not offer it as a privacy control for this
new value.

The standalone status write is not included in the existing combined main-profile
Save transaction. Do not present two separate API saves as one atomic action.
Coordinated staged main-profile/status saving remains UI/backend integration work.
See [UI handoff](backend-ui-handoff.md) for affected screens and recovery states.

No agent principal, credential, executor or production adapter is introduced.
The inactive bio foundation remains inactive. Future agent status replacement
must coordinate these human writers and require exact manual owner approval,
current granted scope/revocation, trusted actual actor and truthful history. Current
human receipts must not be relabeled as agent actions. No agent overwrite is made
possible by this batch.

Custom status text, avatar-corner icon/emoji, their validation/limits and expiry
remain separate unfinished work. No arbitrary length, symbol format, timer, avatar
delivery or online/offline model is invented. This closes the shared manual-
availability subset only, not the full profile/status umbrella.

## Migration and verification

Additive `20261016010000_shared_manual_availability` creates one enum and two
tables with owner/receipt keys, unique revision, checks and foreign keys. No user
row rewrite, selected-value backfill, role grant, legacy privacy-policy change or
new default availability. DDL locks and migration-before-application cutover are
required for eventual deployment. Rollback code can leave additive tables in
place; do not discard status/history as a routine code rollback. User deletion
cascades match existing profile ownership; current production account deletion is
soft lifecycle change, retaining rows while public reads stop.

The new HTTP/PostgreSQL suite covers all choices/unset/clear, public viewer equality
under all legacy STATUS policies, truthful human attribution, request replay and
readback after a newer clear, actual committed write with injected lost HTTP ack,
concurrent retries/writes, input/selector rejection, zero-grant access, inactive/
foreign/stale identity checks, rollback on receipt failure, sanitized unavailable
errors and OpenAPI. Upgrade fixtures retain whole User, ProfileAudiencePolicy and
RolePermission digests and prove zero inferred statuses/history. Fresh migration,
schema parity, full regression gates and independent review accompany the local
checkpoint. No production migration, credential, push or deployment is performed.
