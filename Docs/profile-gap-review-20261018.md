# Profile gap review — 18 October 2026

This review compares current `dev` source at base
`13f4b6f18a6a2bb310ec79f41d99ce4a12e0db90` and the preserved local patch with the
[Account and Access page](https://chatgpt.com/space/page_fadaddb23b508191863a3cd39cc2bc81)
and [API gap register](https://chatgpt.com/space/page_86c68f025ae08191bfcddcb21524cfea).
Older unchecked descriptions do not undo subsequently verified local contracts.
The parent owns checklist acceptance; this file changes no shared checkboxes.

**Later approved increment:** avatar upload/crop/removal/authorized delivery and
custom status text/emoji/explicit expiry are now implemented locally. Root Profile
edit/Save and public profile projection include them; basic `/users/me` keeps its
compatible shape. See the [current contract and evidence](profile-media-status-contracts.md).
Feature-gap and pending-decision statements below are historical observations
from before that approval and are superseded for this implemented scope.

For current integration readiness use the
[frontend inventory](frontend-readiness-20261018.md). The table and pending-feature
assessment below preserve the earlier observation before media/status approval;
they are not the current feature inventory.

## Historical support observed before media/status approval

| Area                     | Local backend contract                                                                                                                 | Remaining boundary                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Authoritative self read  | `GET /users/me`: id, workspaceId, displayName, firstName, lastName, username, phoneNumber, bio, birthDate                              | No avatar or custom-status fields                                                                                           |
| Names and administration | Independent firstName/lastName, compatible legacy fullName, structured `POST /users` with users.manage and workspace admission         | No mandatory last name or legacy split; username/phone editing is not selected                                              |
| Biography                | Optional plain text up to 1000 characters, explicit null clear, independent audiences and viewer projection                            | Frontend persistence not verified                                                                                           |
| Birthday                 | Real date-only YYYY-MM-DD, years 0001–9999, optional/null clear, independently filtered day/month and year                             | No age gate selected; frontend wheel/accessibility not verified                                                             |
| Audiences                | Everyone, directed Contacts, explicit accounts plus dynamic own-workspace custom sets, default private when absent                     | AVATAR/STATUS policy records do not create corresponding field storage or delivery; STATUS is inert for shared availability |
| Atomic main Save         | `/users/me/profile/edit`, `/changes`, `/operations/:requestId`; coherent baseline, aggregate revision, whole-Save receipt and rollback | Done must stage locally; uploads/custom status are excluded                                                                 |
| Manual availability      | AVAILABLE/AWAY/BUSY/null; standalone revision/receipt and main Save integration; shared public status route                            | No automatic presence; no custom message, selected symbol or expiry                                                         |
| Contacts and aliases     | Directed contacts and caller-private aliases; bounded combined account/workspace picker                                                | No foreign roster browsing or sharing implied by contact addition                                                           |
| Telegram link read       | LINKED/NOT_LINKED/INCOMPLETE from current stored verification record                                                                   | No unlink/relink/recovery or reachability assertion                                                                         |
| Avatar                   | Audience foundation only; no stored asset, image upload/change/crop/removal or authorized delivery route                               | Storage, accepted image constraints, normalization/crop, delivery/cache, ownership and old-asset cleanup need a contract    |
| Custom status            | No custom text, symbol or expiry columns, DTO fields or routes                                                                         | Text limit/format, symbol representation, visibility and expiry rules need explicit selection                               |

These capabilities are locally implemented and tested, not deployed or verified in
a frontend. Shared availability follows the later 16 October decision documented
in [its contract](shared-manual-status-contracts.md); the older shared Page's
audience-valued status proposal does not redefine that existing field.

## Current bounded compatibility correction

The basic self read/PATCH and public profile lookups accept no query parameters.
Unsupported selectors such as accountId, viewerId, workspaceId and includePrivate
must return 400 instead of being silently ignored. They never select an owner or
viewer. Self identity remains derived from current persisted authentication;
public identity remains selected only by the path, and optional authentication
continues to reject invalid credentials. Query-free clients keep their existing
shapes and behavior. No new visible profile field or permission is introduced.

Public profile and shared-availability lookup by UUID first preserve an exact stored text identity. If that key
is absent, case-insensitive lookup succeeds only for one unambiguous stored ID,
returning its original identity and existing audiences. Distinct legacy text IDs
differing only by case retain their exact lookups and relationships. A nonexact
ambiguous spelling returns 404, including when one candidate is inactive. An
inactive exact key never redirects to an active case variant. Missing/inactive
identities remain 404, private fields remain null, and reads do not bump revisions.

Atomic Save, existing availability, idempotency namespaces, receipt histories,
all-writer revisions, lifecycle/membership/role rules and current audiences remain
unchanged. Migration `20261018000000_profile_lookup_casefold` adds a nonunique
`lower(User.id)` index for bounded ambiguity lookup; it rewrites no historical
identity/content or relationship and does not impose case-insensitive uniqueness.
Both readers reuse one identity resolver within their existing repeatable-read
snapshots. This also corrects the older availability reader's unconditional
lowercasing, which could select another legacy account. Availability values,
visibility, revisions and receipts are unchanged. The raw expression index is
maintained by SQL because Prisma cannot model it.
Ordinary index creation takes a database lock and needs a deliberate migration
window on a large production table. No production migration is authorized or run.
An old application can retain the additional index when rolling back the binary.

## Historical pending assessment before media/status approval

The requested avatar and custom-status feature families remain missing. A proposed
bounded text/emoji contract and an avatar storage/delivery direction were submitted
as explicit choices, not adopted as defaults. No prototype value, existing template
storage service or older conditional checklist proposal authorizes selecting those
personal-data policies silently. Work dependent on those answers remains pending.

The parent's follow-up requested concrete defaults while approval is pending.
[Storage inspection and the avatar/status proposal](profile-avatar-status-proposal.md)
separate existing capabilities from proposed limits, delivery, emoji, expiry and
the still-unselected custom-status audience. This is a draft, not runtime policy.

API02, API03 and API12 remain partial/open. This batch can close only the concrete
lookup/query-validation defects above. It cannot establish frontend/Figma wiring,
deployed readiness or implementation of the pending feature families. Search
research remains with the cloud task; no duplicate experiment runs locally.

## Changed files in this batch

- `src/accounts/accounts.controller.ts`, `accounts.dto.ts`: strict query DTO and self-route contracts.
- `src/accounts/public-profile.controller.ts`, `profile-privacy.service.ts`: public query contract and identity resolution.
- `src/accounts/profile-account-lookup.ts`: shared exact-first, unambiguous fallback resolver.
- `src/accounts/manual-status.controller.ts`, `manual-status.service.ts`: same identity handling for the existing shared availability read.
- `prisma/migrations/20261018000000_profile_lookup_casefold/migration.sql`: additive nonunique expression index.
- `test/self-profile.spec.ts`, `profile-picker.http.spec.ts`, `manual-status.http.spec.ts`: HTTP, privacy, legacy identity and indexed-query regressions.
- `Docs/api/openapi.json`, `endpoints.json`, `postman-operation-docs.json`: regenerated local runtime contracts for all 160 operations.
- `Docs/api/README.md`, `Docs/backend-ui-handoff.md`, this review: current local support, compatibility and decision handoff.
- `Docs/profile-avatar-status-proposal.md`: source-grounded draft defaults requested by the parent; no feature activation.

Existing command-disclosure edits, publication evidence/plan, README and delegation
assessment are preserved. No external Postman publication, shared Page update,
push, commit/tag, deployment, credential creation or live access change is part
of this batch. The existing isolated database alone receives the index migration.

## Verification and readiness

Final frozen-source verification: **1,073 tests / 56 suites passed**, including
all profile, atomic Save, manual availability, authorization, concurrency,
idempotency, session and persistence regressions. Five new HTTP cases cover strict
self/public queries, alternate UUID spelling, exact legacy case-distinct profiles
and availability, inactive/ambiguous fallback denial and unchanged private values.
The existing index test additionally proves the equality query can use
`User_id_casefold_idx`. The initial focused run passed 135 tests before the final
legacy-identity refinement; final full-suite success supersedes intermediate runs.

Lint, typecheck, format, build and `git diff --check` pass. All 32 migrations are
applied and Prisma schema validation/migration status pass on isolated
`127.0.0.1:55439/profile_test`. Local OpenAPI/inventory/request templates cover
160 operations across 24 controllers; generated references, placeholder bodies
and quoted revisions validate, and Postman OpenAPI syntax lint reports no issues.
The exporter performs no application/provider requests or cloud publication.

The query-validation and identity-lookup fixes are implementation-ready locally;
deployment requires the reviewed index migration and normal release process.
No frontend or deployed readiness is claimed. The database is stopped after
verification. Root README and delegation-assessment hashes remain unchanged.
No whole API02/API03/API12 checkbox is closed by these bounded corrections.
Avatar and custom-status fields remain unimplemented pending explicit product
contracts. There is no executor, repository or local-implementation approval
blocker; the remaining choices concern feature behavior and data handling.
