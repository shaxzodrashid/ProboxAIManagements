# Project viewer membership (MAIN02 bounded subset)

`GET /api/v1/projects` and `GET /api/v1/projects/:id` add required boolean
`isMember`, derived solely from a persisted `ProjectMember` row for the current
caller. Creator identity, role names, `projects.read-all`, `projects.manage-all`
and public read access do not imply membership. It is relationship data, not a
capability or permission summary. Create/update response contracts are unchanged;
the marker is not an accepted update field.

Both reads require the current OPEN caller, workspace and `projects.read` grant.
These are rechecked inside a Repeatable Read transaction; authorization, project
visibility, roster masking and membership come from the same database snapshot.
Captured service actor permissions cannot retain a revoked grant. A change
committed after that snapshot is observed by a subsequent request, not guaranteed
to invalidate an already executing read. Responses use `Cache-Control: no-store`.

Existing visibility is preserved: workspace projects are visible through actual
membership, `readAccessEnabled`, or `projects.read-all`. A foreign workspace
detail is 404; a same-workspace private project without access is 403 and omitted
from the list. Detail includes its existing member roster only for a member or
a caller with `projects.read-all`. A public nonmember receives no roster. As of
the October 26 directory extension, list uses the same roster visibility rule and
returns minimal member names and audience-filtered avatars; see the
[frontend contract](frontend/projects.md#member-names-and-photos-in-the-directory).
The existing aggregate member count remains. Existing updatedAt descending list
order and lifecycle coverage remain unchanged.

This closes only the factual membership marker subset. MAIN02 remains partial:
no ranking, favorites, new visibility rules, capability indicators or
project/task relationship inference are introduced. There is no migration or
data backfill. No provider calls or filesystem writes are required by these reads.

Verification covers list/detail booleans and no-store, public roster masking,
creator without membership, next-request membership changes, private removal,
foreign workspace isolation, read-all roster preservation without inferred
membership, management authority without read-all, stale grants, non-OPEN users,
workspace mismatch, update allowlisting, and operation-specific OpenAPI contracts.
Concurrent removal tests commit membership deletion after the actual authorization
read and before the project query: both list and detail retain a consistent old
snapshot, while the next request denies private access. See `test/task-project.http.spec.ts`
and `test/task-project.openapi.spec.ts`.

Local verification: all 529 tests in 43 suites passed against the isolated
localhost `profile_test` database on port 55439, including nine new membership
HTTP cases. Typecheck, ESLint (zero warnings), Prettier and Nest build passed.
Independent review reported no outstanding finding. No migration was added or
applied by this batch; the isolated database was stopped after verification.
