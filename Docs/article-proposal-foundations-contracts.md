# Private article proposal foundations — 20 October 2026

Status: local independent foundation implemented and full-regression verified;
this is not a completed publication queue. The earlier blocked record is preserved
as `article-proposal-foundations-verification-20261020-blocked.json`. See
`article-proposal-foundations-verification-20261020.json` for the final full
regression/checks and cleanup evidence for this increment.

Final full regression passed **1,986 tests /100 suites** in405.622 seconds;
focused **273 tests /11 suites** passed in48.109 seconds, zero failures/skips.
The93 added tests comprise61 database-free comparison/service/contract cases and
32 real HTTP/persistence cases. Strict typecheck/lint/format/build/release, schema
validation/parity, Bash/ShellCheck and38 local mock deployment checks passed.
Verification uses the previously documented one recycled128 MB worker, installed
isolated-ts-jest and30-second Jest case budget; strict whole-project checking
passed separately, with no application timeout or repository runner config change.

## Settled policy and the independent boundary

Older same-document submissions go first. Contributions arriving before reviewer
visibility should join the older pending proposal; after visibility the reviewed
version stays fixed and later work queues. The existing atomic owner voter-selection
commit is the reviewer-visibility cutoff, not first HTTP read or notification.
The rejected stale-base reconcile-and-revote recommendation is superseded and is
not a pending question. Owner-selected voters, every listed voter voting and
inclusive60% approval remain unchanged.

The later user decision assigns overlapping cross-author alternatives to reviewers,
preserving both contributions. See `article-reviewer-resolution-contracts.md` for
the subsequent local slice and user-selected four-choice/all-voter60% rule with
one top-two runoff. The foundation increment recorded here implemented no automatic
coalescing, conflict choice, reviewer dispatch, vote, promotion or published-head
mutation. Separate immutable authored
contributions and FIFO reservations preserve the evidence that a later combined
candidate will need. The existing single-article review service and its routes
retain their old behavior; they are not silently converted into this new queue.

## Explicit routes and authority

- `POST /projects/:projectId/article-documents`: explicit UUID identity reservation
  with `articles.create`. It creates no article bytes, version, forest publication,
  review or permission. No private draft is automatically adopted. Duplicate IDs
  conflict409 rather than replacing an existing identity.
- `POST /projects/:projectId/article-proposal-candidates`: `articles.edit`, exact
  own draft-space `If-Match`, explicit canonical document/source article IDs,
  nullable `baseVersionId`, `baseForestRevision`, complete `positions` and independent
  `readingOrder`. This is private staging, not push-to-review. It returns
  `PRE_REVIEW`, revision0 and `dispatchAvailable:false`.
- `GET /projects/:projectId/article-proposal-candidates`: current author-only
  metadata or the current project owner's admitted project view, at most50 rows.
- `GET /projects/:projectId/article-proposal-candidates/:candidateId`: exact
  comparison/provenance for that author or current project owner only.

Every operation reloads current OPEN human/capability and owner/membership in the
authenticated workspace under the established Workspace lock. No broad-admin
shortcut or new grant exists. Creation and editing remain separate; the owner
also needs the relevant existing capability to create/stage. Inactive project
writes fail; archived reads retain current resource authorization. Original keys
are retained without an orphan-access fallback after project/account deletion.

An unpublished reserved identity can be staged against only by its creator or
current project owner. Other members cannot acquire its private contents through
a known ID. Published identities can receive another admitted editor's private
contribution. A selected legacy review voter does not gain access to these new
private candidates. Other drafts and proposed contributor views are not shared.

## Exact content and placement comparison

The immutable authored comparison has version1 `before` and `after` snapshots.
Each contains exactly `{format,article,forest}`. Article is canonical identity,
title and exact plain text; `before.article` is null for an unpublished identity.
Forest contains only explicit published ID/parent positions and reading order,
not private draft titles/content or the private draft hierarchy.

Only one selected own draft's title/text is copied. The caller explicitly supplies
the entire proposed published forest positions, including their order, and the
independent reading sequence. They must retain exactly the current published
identities plus this document, without duplicate/missing IDs, private additions,
cycles, excessive depth or excessive count. Existing limits remain100 articles,
depth8, title200 and text10000 UTF-16 units. No sibling placement is silently
appended or inferred. Before/after data preserves Unicode, line endings and
literal text; it does not fetch URLs or render HTML.

Change flags include creation, title, text, this article's parent, whole forest
positions and reading order. Explicit sibling/root ordering changes are flagged
even with unchanged parent/navigation order. This is backend data for an accurate
future change UI, not an implemented UI or a text-merge algorithm.

The source draft revision, selected private article ID, author, base version and
base forest revision are retained. Capture-time optimistic checks prevent a torn
source/base snapshot; they do not implement a queued stale-base rejection policy,
discard pending contributions or require any voter to vote again. Later queue
materialization and overlapping-contribution resolution remain unimplemented.

## Storage, immutability and FIFO provenance

Additive migration `20261020090000_article_proposal_foundations` adds five tables:
stable documents, published-version records, publication-space/counter state,
immutable authored contributions and pre-review candidate reservations. It adds
no existing table column, content backfill, migration of private drafts, latest
legacy-review selection, publication or grant. Model back-relations are additive.

Composite foreign keys bind a head version to its own document and a candidate
to its project/document. Published versions retain an existing review identity,
comparison and explicit provenance; the capture reader validates provenance,
approved review/project association and matching approved text for a retained
base. No version-creation API is exposed. Future promotion must additionally
prove the complete frozen reviewed comparison and update head/forest atomically;
this foundation does not turn legacy text-only approval into structural approval.
Unknown formats fail closed without rewrites.

The migration includes update-rejection triggers for version snapshots
and authored contributions, and positive revision/sequence checks. Real fixture
tests and the rolled-back actual-migration smoke test verify the update guards and
own-document/project constraints. These are not a destructive-delete,
restore, permanent retention or external-writer containment policy. No API to
delete/update these immutable bytes is introduced.

The publication-space counter allocates one durable project-local sequence under
the common lock; sorting by it gives same-document FIFO independent of UUID or
equal timestamps. Staging changes only that counter, never the published forest
or current head. Separate authored inputs are retained individually; no earlier
candidate is overwritten by a newer author's whole snapshot.

Public DTOs omit raw sequence, queue position, hidden counts, hashes, profile and
other authors. Pagination returns an accessible candidate identity; the next
request resolves it under the same authorized scope before using its ordinal.
It is a live view, not a frozen queue snapshot or a permission-bearing cursor.

Duplicate candidate/semantic-input identities conflict409, without automatic
replay. Transaction uncertainty uses existing mutation semantics; known read
availability uses sanitized503, unknown errors retain500. After uncertainty the
caller must reread its own candidate identity and reconcile intent. Real database
rollback, races and committed-acknowledgement recovery are covered by real
separate-client/persistence tests as well as database-free classifier tests.

## Verification and remaining integration

Database-free tests exercise exact snapshots/structural ordering, provenance
formats, explicit DTO/permission contracts, private predicates, current-authority
checks, FIFO allocation, candidate separation, stale capture prevention, safe
errors and unavailable dispatch. The201 tests /8 suites passed with61 new tests;
these mocks alone do not establish real SQL behavior. The final focused run adds
32 real HTTP/persistence cases and passes273 tests /11 suites in48.109 seconds,
zero failures/skips. It covers private author/owner/legacy-voter isolation,
capability separation, approved-byte/head preservation, immutable update/head/
project constraints, duplicate concurrent clients/FIFO allocation, later source
revisions, disabled review/promotion routes, source races, transaction rollback,
lost acknowledgements, read availability, bounded real paging/private cursors,
read/write revocation, owner transfer and workspace context changes.

Automatic approval review initially rejected starting the existing isolated synthetic
PostgreSQL fixture, citing the earlier read-only assessment scope and its ban on
fixture startup/tests. The process was not started; a subsequent status read
confirmed nonexecution. Independent static and database-free checks continued.
After new relevant authorization evidence explicitly clarified the implementation/
test scope and permitted one bounded retry, the identical fixture startup command
succeeded on that single retry. No host/method workaround was used. The migration
was applied only to the identity-verified synthetic fixture, with all80 old table
application-table row digests unchanged (excluding migration bookkeeping) and
exactly five empty new tables. A fully rolled-back
scratch schema executes the actual migration, preserves a legacy review, proves
no automatic identity/version/candidate adoption, and checks immutable-update and
own-document-head constraints. No production operation occurred.

One intermediate expanded run passed272/273: the workspace-transfer test attempted
to move its synthetic user while role assignments still referenced the old
workspace. The database correctly rejected that fixture mutation. The test now
removes/restores only its synthetic assignments around the move, matching the
existing documented pattern; no runtime source change was needed. Final focused
273/11 supersedes that attempt. The original denial and failed attempt remain in
the local evidence. Final schema parity, full memory-conscious regression from
1,893/96 and owned fixture/cache cleanup are recorded in the verification file.
The fixture is stopped, its listener and nine known logged test worker PIDs are
absent, and the exact owned cache was removed after path/reparse checks. Final
document/version/publication-space/contribution/candidate/review/vote/scratch
counts are zero. The exact11 permanent platform triggers matched their allowlist
with no unexpected/fault triggers. Only synthetic approved snapshots were created
for tests and cleaned; no actual user articles were published.

Automatic owner conflict resolution is rejected. The later reviewer-resolution
slice adds local pre-review materialization, head-only dispatch and atomic-freeze
source and the subsequent immutable four-option/runoff ballots. Its contract
distinguishes actual verification from publication integration. KEEP_BOTH and
multiway published representation, approved version/forest promotion, frontend
wiring and production activation remain
pending. All source is local/uncommitted; prior
work and historical Library snapshots remain intact. No actual publishing,
production, Postman, upload, credential, paid call, commit/push/deployment or live
permission/security change occurred.
