# Public identity on human task reads

## Selected requirement and boundary

Available since local `0.3.0-dev.3`. The authoritative API Feature Gaps page
(`page_86c68f025ae08191bfcddcb21524cfea`, sequence81, reread16 October2026)
requires stable account identity and public full names for Task Manager compact
assignee controls in **TASK04**, reused for checklist items in **TASK05**.
This implements that read subset. Both umbrella items remain partial; avatar
delivery remains API03 and has no implementation in this batch.

The existing API13 public identity is the source of names, not administrative
account DTOs, private contact aliases or role labels. `publicIdentity()` composes
nonempty independent first/last names, or falls back to the complete legacy
`fullName` verbatim. It never guesses a first/last split or requires a last name.

## Fresh read contract

GET `/api/v1/projects/:projectId/tasks`, `/:taskId`, and `/query` items add required
`assigneeIdentities`, ordered by the corresponding persisted assignee ID:

```json
{
  "assigneeIds": ["00000000-0000-4000-8000-000000000001"],
  "assigneeIdentities": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "displayName": "Public name",
      "firstName": "Public name",
      "lastName": null,
      "username": null
    }
  ]
}
```

Each identity has exactly `id`, `displayName`, `firstName`, `lastName`, `username`.
The array is empty when no eligible names are available. Checklist items keep
their existing shape: resolve their `assigneeId` through this same array. The
current assignment invariant requires checklist assignees in the task's whole
assignment set. No repeated per-item names or additional identity endpoint is
needed. Consumers can derive initials from the public display name; unresolved
IDs retain an unnamed fallback rather than a fabricated or stale private name.
No initials algorithm, UI implementation or image availability is asserted.

Only OPEN accounts in the task's workspace are hydrated. API13 public profiles
already exclude inactive accounts; existing project pickers exclude foreign
workspace accounts. Retained inactive/inconsistent foreign assignment IDs stay
in `assigneeIds` and checklist references without names, lifecycle reasons or
new disclosure. OPEN former project members can retain public names: their
names are already public, while membership/action eligibility is independently
enforced. This does not expand who may be assigned, act on or read a task.

Existing fresh OPEN viewer/project membership and workspace checks run before
projection, in the same RepeatableRead transaction. Ordinary members need no
users.read, picker-management or task assignment grant to see selected public
names. Public project access/read-all execution grants remain insufficient.
Archived projects retain the same member-only read behavior. Responses remain
`Cache-Control: no-store`; revocation removes task access on subsequent reads.

Read-only selection extends `humanTaskSelection` with only public identity and
internal status/workspace eligibility fields on assignees. Selection never reads
phone, bio, birth date, Telegram details, aliases, credentials or roles. The
allowlisted public projector never emits the internal eligibility fields.

## History and pagination compatibility

`HumanTaskReadResponseDto` declares the array using `PublicIdentityResponseDto`;
the original frozen `HumanTaskResponseDto` is unchanged. Mutation responses,
audit before/after snapshots and idempotent retries do not contain names, and
older outcomes are not rewritten or dynamically enriched. Refresh a GET to
obtain current display metadata.

Public name/lifecycle changes do not alter task revision, task timestamps, task
filters, ordering, counts or query-generation fingerprint. Names are current in
each page's transaction, not frozen by the cursor's `asOf` timestamp. A rename
can appear on continuation without a409, and inactive names disappear from
subsequent pages. This is an explicit display-freshness limit; task generation
and membership revocation checks otherwise retain their existing contracts.

## Verification and safety

HTTP/OpenAPI/PostgreSQL regressions cover exact allowlisted fields, structured
and verbatim legacy names, optional last name, private alias/bio exclusion,
shared task/checklist lookup, all three fresh reads, all three inactive lifecycle
states, retained OPEN former members, inconsistent foreign assignment references,
rename refresh, unchanged frozen assignment retry/audit, current per-page query
hydration, denied metadata writes and revoked viewer access. The existing archive
projection fixture explicitly accepts the new field.

Tests use guarded isolated `127.0.0.1:55439/profile_test` and fixture-owned data.
No migration, schema backfill, new grant, role change, external integration,
availability default, production operation or deployment is needed. Existing
README edits and historical migration evidence remain preserved. Reverting this
batch removes the additive field without changing stored task or profile data.
Final quality-gate counts and independent review accompany the delivered commit.
