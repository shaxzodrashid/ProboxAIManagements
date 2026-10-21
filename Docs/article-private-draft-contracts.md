# Individual article draft foundation — 20 October 2026

Later increment: the user has settled voter-list authority as the project owner.
The separate `article-publication-review-contracts.md` now defines explicit
single-article submission, a frozen electorate, all-votes completion and inclusive
60% approval. Historical publication exclusions/counts below describe this earlier
private-draft increment; private spaces and unrelated drafts remain private.

This is a bounded private-draft implementation. The supported explicit fixture
startup resolved the earlier verification blocker. It does not close SPACE01–04. The baseline
checkpoint's 1,550-test result belongs to the earlier shared-checklist source.
See `article-private-draft-verification-20261020.json` for this slice's evidence.
Final frozen-source regression: **1,595 tests /88 suites passed** in235.273 seconds.
Article-focused: **45 tests /4 suites passed** in13.14 seconds. Both runs have zero
failures or skipped tests.

## Reconciliation and authority

There was no article model, route, search index, media storage or publication
implementation in the inspected source. Existing contracts selected multiple
article roots and Previous/Next order independent of hierarchy. The user's
correction separates creation from editing, permits individual drafts and requires
reviewed publication. Later trusted user evidence settles that all voters on the
selected list must vote before any decision, then at least60% affirmative approves,
inclusively using exact integer arithmetic. No early publication is allowed.
Voter-list ownership/management remains the pending authority decision. No
publication path or voting logic was added in this slice.

`articles.create` and `articles.edit` are separate explicit-grant catalogue keys.
Neither is added to built-in role defaults or automatically granted by bootstrap.
No seed or live authorization mutation was run. Create does not confer edit,
arrange, publish or restore authority. Edit does not confer creation authority.

Every request acquires the existing Workspace row lock and reloads the OPEN actor
and its currently assigned capability, then requires the current project owner
or a current project member in the actor's current workspace. `projects.read` is
the read capability. `projects.read-all`, `projects.manage-all` and workspace
administration do not substitute for this article membership or draft ownership.
Revoking a capability, membership or account eligibility before admission blocks
the request. Archived/deleting projects reject mutations; archival retains reads.

A private space is keyed by project plus the requesting individual's identity.
There is no caller-supplied owner selector. Even another fully authorized project
member sees only their own space and receives 404 for the first person's draft
detail/edit. Project-wide file reads do not expose drafts: draft contents exist
only in database records, never project files or object storage. No article
search, media resolution, upload, history disclosure or sharing path is added.
Text containing a URL is plain text and is never fetched or embedded.

## Routes and DTOs

All routes use the existing bearer access guards and return `Cache-Control:
no-store`. Unknown body fields are rejected by the normal global validation pipe.

| Route under `/projects/:projectId/article-drafts` | Capability      | Contract                                                                                     |
| ------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| GET `/`                                           | projects.read   | Individual space: format, revision, articles, readingOrder                                   |
| GET `/:articleId`                                 | projects.read   | Own plain-text draft, parentId, revision, previousId, nextId                                 |
| POST `/`                                          | articles.create | Explicit UUIDv4 id, title, text; append a new root and append its reading order entry        |
| PUT `/:articleId`                                 | articles.edit   | Replace own title/text, preserve identity and placement                                      |
| PUT `/`                                           | articles.edit   | Explicit complete placement and complete reading sequence, preserving all identities/content |

Mutation responses return the current complete individual space. The content
format is a minimal version-1 plain-text draft envelope, not a rich editor/block
contract. Title length is 1–200 and text length is 0–10,000 characters. Responses
project only explicit fields; stored future/internal fields are not disclosed.
Unknown retained fields are omitted from read projections; mutations refuse to
rewrite such snapshots so future content cannot silently disappear.
Unsupported/malformed retained formats fail closed with
`ARTICLE_FORMAT_UNAVAILABLE`409 and are preserved without rewriting.

Every mutation requires the existing exact quoted `If-Match` revision of the
individual project draft space. An empty legacy project has revision0 without
backfill or writes. All its draft changes share this revision so editing and
arrangement cannot silently overwrite each other. Missing/invalid headers use
the existing428/400 contract; stale revisions return `STALE_REVISION`409.
Creation identity collisions return409. On a lost response, GET and reconcile the
explicit draft identity/current revision. There is no automatic write replay or
claim of exact request-receipt idempotency.

## Forest, reading order and preservation

A space supports at most100 drafts, multiple roots and depth8 (root counts as1).
Every parent must be in this same individual's project forest; self-parenting,
cycles, missing/foreign parents and excessive depth fail with400. Placement must
retain every existing draft exactly once. The articles array supplies display
order within each sibling group. Reading order is a separate exact permutation
of every draft identity. Previous/Next use only that sequence and have null ends.
No shared or global draft navigation is inferred.

The Workspace lock, fresh checks, common revision, forest snapshot and append-only
revision snapshot commit together. No filesystem/provider effect runs in that
transaction. Competing revisions have one winner in the real separate-client
PostgreSQL verification case. Failed revision persistence rolls
back the snapshot in the synthetic test. No delete, restore, pruning or historical
snapshot mutation endpoint exists. Stored snapshots are internal preservation,
not a selected version-history disclosure or restoration policy.

Migration `20261020050000_article_private_drafts` is additive: two new tables and
nullable reference links. It rewrites no old records, publishes nothing and grants
no permission. It was applied only to the isolated `profile_test` fixture after
verifying its database/user/address/port and out-of-recovery identity. Prisma
reports no schema difference. A fully rolled-back scratch-schema check using the
actual migration preserved representative old values/counts/grants/audit,
introduced no draft backfill and retained draft keys/content/revisions while
nulling live references after synthetic project/user removal.
Existing project/user deletion can null only live reference links while retaining
the stable original project/owner keys and revision content; no new FK restriction
blocks the existing project deletion workflow. Such orphaned drafts remain
unreachable because every access must resolve the current project and actor.
There is no orphan disclosure/reassignment/purge workflow. Keep these tables if
rolling back the application; there is no destructive down migration.

## Verification and remaining scope

37 synthetic tests cover separate capabilities, current grant/account/workspace/
membership/project changes, private detail/list/edit isolation, broad-grant
non-bypass, old project reads, explicit DTOs, unknown fields, unsupported retained
formats, hierarchy/order/depth/capacity, navigation, stale concurrent writers,
revision failure rollback, archives, safe read availability failures, explicit
OpenAPI security/response DTOs and no-store metadata.
The synthetic transaction adapter is not a PostgreSQL concurrency proof.

Eight additional real HTTP/persistence cases passed in
`test/article-drafts.http.spec.ts`, guarded by the existing exact synthetic
`PROFILE_TEST_DATABASE_URL` contract. They cover capability separation, individual
isolation, old data, validation, absent unfinished routes, retained text, tree
rollback, stale-authority checks and separate-client concurrent edits. Final
focused result:45 tests /4 suites passed, zero failures/skips in13.14 seconds.

The initial normal and escalated starts omitted the previously verified `-o`
options. Both reached PostgreSQL and failed binding `localhost` IPv4/IPv6 with
OS permission errors; neither was rejected by tool policy or approval review.
Their failed logs did not establish a target port. The earlier handoff's claim
that those failures targeted55439 was too specific. Using the known-working
`pg_ctl start -D <existing-fixture-data> -l <existing-fixture-log> -o '-h 127.0.0.1 -p 55439'`
in the permitted host execution context started the fixture successfully. No
listener/security configuration was changed.

The initial broad regression attempt discovered86 suites:43 passed,9 failed and34 skipped;
485 tests passed,126 failed and973 skipped (256.95 seconds). These comprised123
mocked-HTTP failures attributable to localhost connection `EACCES`, one
explicit symlink `EPERM`, one project move failure mapped from filesystem
`EACCES`/`EPERM`, and one project-trash catch-all unresolved-operation error whose
underlying cause was not established. None of those failing suites requires the
PostgreSQL fixture; the973 skips resulted from the fixture URL not being set.
The initial attempt was not a clean regression result. That run
predates the final OpenAPI controller annotations, forward-field preservation
guard, two contract tests, the preservation test and eight prepared database cases;
the final focused run covers the final article source. Typecheck, lint, formatting,
build, release consistency and Prisma validation passed. Bash syntax/ShellCheck
and all38 mock deployment checks passed after host startup restrictions were
resolved for those tools. Migration SQL was compared with Prisma's offline
generated schema SQL; actual fixture migration/parity/preservation now also pass.

The complete regression then ran with the exact fixture URL in the permitted
host context. All88 suites and1,595 tests passed, including every previously
failing suite and the project-trash case. The remedy/verification pass required
no source change; all14 source hashes match the finalized article handoff. The original
trash error's underlying syscall was not retained, so no narrower cause is
claimed. No initial failure remains reproducible in the final run.

The fixture stopped cleanly after testing. Final checks report no server, zero
owned test processes and zero fixture-port listeners. The owned workspace Jest
cache was removed after verifying its exact path. The additive fixture migration
is retained; no production migration or production activation occurred.

Removing only this slice's schema models/relations and formatting the reconstruction
reproduced the prior shared-checklist schema hash exactly:
`529f6a33345a5c9e277a0532a9df274bd473cddd475c03a074b92e75cfc8e232`.

Publication/review/voting, reviewer authority, rich editable blocks, shared or
published article reading, version history disclosure, version restore, media,
embeds, retention/deletion policy, frontend wiring and production activation remain
outside this slice. Publication routes are absent (404); no ordinary editor
publish button or quorum was invented. The parent must clarify voter-list
ownership/management before publication implementation. The all-votes and
inclusive60% decision gate is settled but deliberately remains unimplemented here.
No missing product decision is required to retain this bounded private plain-text
draft foundation.

All earlier uncommitted development work remains in place. No Postman, upload,
commit/push, deployment, production migration, live grant, paid/provider call,
credential issuance, agent, username/phone feature or presentation work occurred.
