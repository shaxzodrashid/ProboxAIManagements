# Self profile and structured names

This local batch implements API 01 and the name/bio foundations of API 02.
The existing `/authorization/me` response is unchanged. All DTO keys follow the
repository's camelCase convention.

`GET /api/v1/users/me` requires an access JWT and a currently OPEN identity,
including accounts with zero permissions. It returns only `id`, `workspaceId`,
`displayName`, `firstName`, `lastName`, `username`, `phoneNumber`, and `bio`.
The current persisted identity supplies both the user ID and workspace scope;
neither can be selected through request input. Access grants remain available
through `/authorization/me`. No workspace display label is invented.

`PATCH /api/v1/users/me` accepts only `firstName`, `lastName`, and `bio` and
returns the same self response. Unknown fields are rejected. Omitted fields
retain their values; null clears a component. Empty PATCH is a read-equivalent
no-op. Names are trimmed at their boundaries, are nonempty when supplied as
strings, and have a 120-character limit per component. Internal whitespace,
case, Unicode spelling and multiword components are preserved. A name update
must leave at least one nonempty component: neither first nor last name is
individually mandatory. Bio is plain text with a 1000-character limit; null
clears it and an empty string is retained. Clients must render it as text.

These limits and the one-component minimum are bounded implementation choices,
not evidence that the proposed mandatory-first-name policy was approved.
Bio format/length/audience remain provisional pending the owner's decision;
this batch exposes bio only through authenticated self read/update.
Username, phone, roles, permissions, lifecycle, workspace membership, avatar,
birth date, availability and badge/status fields cannot be edited through this
contract. Bio is self-only and is not added to administrative list responses.

Administrative `POST /api/v1/users` retains its `users.manage` gate, phone and
role rules, and PENDING lifecycle. Supply either legacy `fullName` (deprecated)
or one or both structured name components. Mixing inputs or omitting all names
returns 400. Explicit null is rejected for creation name fields. Structured
names round-trip in create/list/ban/delete user responses. The compatibility
`fullName` is composed as first name then last name with one separating space.
No administrative identity edit capability is added.

The additive `20261011000000_self_profile_names` migration creates three nullable
columns without backfilling or changing existing rows. Legacy `fullName` is
never split. It remains the authoritative display fallback until a structured
name is supplied. A name update replaces `fullName` with the composed name so
existing task/project projections continue to display the updated identity.
Bio-only updates leave legacy names untouched. Concurrent name mutations check
the previously read components and fullName atomically before writing; a race
returns 409 and rolls back the whole patch. Reread and reconcile before retrying.
This does not implement revision-aware stale-client conflict detection.
Rerunning the bootstrap seed preserves structured names and their composed
fullName. Its prior name-refresh behavior remains available for legacy identities
whose firstName and lastName are both null; the condition is checked atomically.

Migration application requires normal PostgreSQL ALTER TABLE locking. No table,
identity, authentication token or existing name is deleted. The new application
requires the migration before use; rollback of application code can leave the
additive columns in place. No production migration is authorized by this batch.

API 02 remains partial: avatar storage/crop/visibility, birth date/privacy,
manual availability, status text and icon/emoji contracts require further work.
The parent owns Space checklist updates.

## Verification on 11 October 2026

Verified from clean `main` at `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`.
Typecheck, ESLint, production build, changed TypeScript formatting and
`git diff --check` pass. The complete Jest run with isolated persistence enabled
passes 121 tests in 20 suites, including current authorization regressions,
real Nest HTTP request validation/guards, self response and OpenAPI contracts,
legacy migration preservation, persisted names/bio, workspace isolation,
transaction rollback on invalid clears, and racing name updates.
An independent review identified and corrected bootstrap seed overwriting of
composed fullName; a real database regression verifies structured-name retention
and legacy seed compatibility.

All nine repository migrations applied to a fresh temporary PostgreSQL 18
database; Prisma migration diff reports no difference from the schema. No
production database or running application was used. The temporary server was
stopped after validation. Jest and PostgreSQL needed sandbox escalation because
Windows sandbox file-renaming restrictions blocked their cache/WAL writes.

The database suite is opt-in and never falls back to `DATABASE_URL`. It requires
`PROFILE_TEST_DATABASE_URL` targeting `127.0.0.1:55439/profile_test`, a newly
isolated test database with migrations applied. Run `pnpm test` with that
variable to include persistence tests; without it, the four database tests
are skipped. The HTTP suite uses mocked database access with real guards and
the production validation settings. It does not simulate Telegram registration
or deployed network/storage behavior.
