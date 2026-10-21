# Canonical reviewed article publication — 20 October 2026

Status: local uncommitted implementation with database-free/static verification.
The additive migration, real SQL preservation, HTTP/persistence tests and current
full regression are blocked by automatic approval review. The latest completed
full-regression milestone remains the earlier2,061 tests /105 suites; it does
not verify the new canonical implementation. No real article publication,
production migration, upload, Postman, credential, paid call, live permission
change, commit/push or deployment occurred.

## Settled behavior implemented locally

- Frozen conflict-free content AND the entire explicit forest/order use the
  existing fixed owner-selected eligible reviewers, every reviewer completing,
  and inclusive60% approval. One immutable boolean approval per reviewer is
  distinct from the four-option conflict ballots. It does not create another
  approval round for A/B conflicts.
- Completed supported A/B decisions use the existing four choices and single
  runoff directly, without a redundant binary vote. KEEP_BOTH and genuinely
  multiway promotion remain closed. All alternatives, choices, ballots and
  contributions remain retained.
- The final supporting ballot/approval attempts promotion in the same transaction:
  append one immutable version with resolution provenance, set the canonical
  document head, update the full approved forest/order and increment its revision,
  then complete the review. The existing Workspace lock serializes cooperating
  review, authority and publication changes. Old versions and private drafts are
  never rewritten. Version numbers append after retained history.
- Reviews capture the exact head identity and forest revision at committed
  reviewer visibility. Promotion requires those identities/revisions AND exact
  before content/forest to match the current published base. A mismatch or an
  unsupported stored base preserves the completed decision as DECIDED, with no
  overwrite, automatic rebase or new vote. Database faults retain transaction/
  uncertain-outcome semantics instead of being disguised as compatibility errors.
- REJECTED/RETURNED_FOR_REVISION retain their prior FIFO behavior. Successful
  promotion completes APPROVED and releases the next same-document submission.
  An approved but incompatible DECIDED review still blocks later same-document
  dispatch; its immutable decision is not silently skipped.

## Additive provenance and old data

ArticlePublishedVersion keeps its legacy nullable reviewId and gains a nullable,
unique resolutionReviewId, with a same-document foreign key and exactly-one-
origin check. Existing versions retain their original legacy review and format1
provenance. No legacy approved snapshot or private stage is automatically adopted.
New resolution versions use exact format2 provenance: resolutionReviewId,
outcome, final round (0 for conflict-free approval), and retained contribution IDs.
Reads validate the actual complete reviewed decision, exact comparison and
provenance. They do not manufacture a legacy ArticleReview row.

The migration adds one immutable approval table and nullable review base columns.
Unknown bases on older resolution rows are not backfilled; those decisions remain
closed to promotion until their original basis can be established. Existing
version/content triggers remain, with new immutable approval/base guards. This
schema has not been applied to any database in this increment.

## Explicit API and authority

All paths below are under projects/:projectId, use current bearer/project
authorization and no-store. No new capability, automatic grant, ordinary editor
publish override or media disclosure is introduced.

POST article-resolution-reviews/:id/approval accepts an explicit boolean and own
immutable ballot If-Match0. Current selected reviewers only. Exactly matching
initial retries are idempotent; replacement votes conflict. Archived/deleting
projects reject changes. Nonselected owners and authors cannot approve.

POST article-resolution-reviews/:id/publication reconciles only an already
approved immutable decision, as the current selected reviewer or owner. Its body
and query are empty/strict. It accepts no article bytes, alternative, base or
override. A successfully reconciled version is reused, including if a newer head
now exists; retrying an old review does not restore or replace that newer head.

GET article-tree returns only the validated current approved canonical forest and
its revision. GET article-documents/:id/publication returns the immutable current
head ID/number/content, forest revision and Previous/Next canonical IDs from the
explicit readingOrder. Multiple roots remain supported. Private reserved
identities, drafts and unpromoted proposals are absent. Current membership or
ownership, OPEN account/workspace and projects.read are rechecked within the
read transaction. Published readers do not gain access to private review detail,
losing alternatives, electorate, ballots, source draft IDs or private provenance.

Legacy review-keyed publication APIs retain their existing behavior. No historical
version listing, restore API, content deletion, rich block or media policy is
inferred from canonical reads. Known dependency failures use sanitized503;
unknown failures retain500.

## Verification barrier and exact approval required

The owned isolated PostgreSQL fixture startup succeeded. The subsequent compound
identity/preservation/migration command was denied before its process executed.
Its migration operation was:

```powershell
$env:DATABASE_URL='postgresql://profile_test@127.0.0.1:55439/profile_test'
pnpm exec prisma migrate deploy
```

The target migration is
prisma/migrations/20261020120000_article_canonical_publication/migration.sql,
against the existing isolated profile_test fixture at127.0.0.1:55439 only.
Automatic approval review stated: "this applies a canonical publication/promotion
migration that conflicts with the trusted instruction that publication was not
authorized for implementation; later assistant claims do not override that
restriction." That initial command did not execute. Later relevant direct user
implementation/runoff evidence permitted one bounded retry after confirmed
nonexecution. The exact target was verified again and89 existing table projections
were captured through read-only SQL. The prisma migrate deploy retry was also
denied before execution. Its stated reason was that broad backend authorization
and assistant/delegation claims do not clearly revoke the original canonical
publication implementation restriction. No alternative migration route was used
and no further retry occurred. Materially new explicit user authorization
superseding that restriction and covering this isolated migration is required
before another attempt. No evidence was inserted into action arguments.

A separate permitted read confirmed profile_test/profile_test,127.0.0.1:55439,
outside recovery; the migration has0 completed records and the new approval
table is absent. The later separately captured89 existing application-table
old-column projections remained byte-identical across the second denial. This
proves no row changes during that attempt; it does not establish applied-migration
preservation. No migration executed. The owned fixture was stopped after both
attempts and its listener removed.

Prepared HTTP/persistence tests cover whole-snapshot approval, exact60% and
all-voter completion, canonical privacy/navigation, multiple roots and reviewed
reordering, immutable older versions, private later edits, cross-document forest
compatibility, final-write rollback, lost acknowledgements, retries/concurrency,
revocation and closed KEEP_BOTH. They remain unexecuted. Database-free promotion,
origin validation, authorization, compatibility and contract tests passed; exact
final counts/static evidence and cleanup appear in the separate current
article-canonical-publication-verification-20261020.json.

## Remaining scope

After approval of the isolated migration: old-column row preservation, rolled-back
upgrade/constraint tests, real focused HTTP/persistence tests, schema parity and
full memory-conscious regression, followed by fixture cleanup. KEEP_BOTH public
variant/placement representation and genuinely multiway A/B policy remain pending
user choices. Equivalent multi-author grouping remains a separate engineering
limit. Frontend integration and production activation were not performed.

Docs/backend-release-catalog.json remains absent and staged for deletion. Its
staged checker fallback remains untouched; a missing-catalog version/changelog
success does not establish full catalog/provenance verification. No release
checker was run or claimed passing in this increment.
