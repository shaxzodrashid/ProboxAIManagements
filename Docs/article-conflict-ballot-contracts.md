# Article conflict ballots and one runoff — 20 October 2026

Subsequent local canonical implementation is recorded separately in
`article-canonical-publication-contracts.md`. Its current270/14 database-free
checks pass, but its isolated migration was denied and real database/full
verification is pending. The completed2,061/105 evidence below applies to this
earlier conflict/runoff increment, not the newer promotion source.

Local uncommitted backend implementation. No real article publication, production
migration, permission grant, upload, Postman, credential, paid call or deployment
occurred. The earlier blocked reviewer-resolution evidence remains recoverable
with its `-blocked` suffix. Current evidence and final verification results are
recorded in `article-reviewer-resolution-verification-20261020.json`.

## User-selected rules

The owner selects a fixed eligible electorate; reviewers decide conflicts, with
both contributions and provenance retained. The four exclusive choices are
KEEP_BOTH, PUBLISH_A, PUBLISH_B and REJECT_BOTH. Every selected reviewer must vote
before a result is taken; a winner requires inclusive60% of that complete fixed
electorate (`count*5 >= electorate*3`). Unanimity, first-reviewer-wins, owner
resolution, plurality publication and an extra binary conflict approval are not
implemented.

If no initial choice reaches60%, there is one top-two runoff. All the same
selected reviewers vote again, and60% still applies. A tie for the second-place
cutoff returns the proposal for revision without an arbitrary tie-break. A tie
for first between exactly two options is an unambiguous top-two set. A completed
runoff below60% returns for revision. There is no third round or automatic
plurality fallback. Both rounds, their frozen options and ballots are retained.

## Private staging, FIFO and atomic reviewer visibility

Creation and editing retain separate capabilities. Each immutable candidate starts
as a private stage, visible only to its author and current project owner. The
author explicitly POSTs `article-proposal-candidates/:id/submit`, using
articles.edit and candidate If-Match0. An owner cannot submit somebody else's
private stage. Accepted submission order is allocated independently of staging
order, with revision1/QUEUED_FOR_REVIEW. Old candidates are not backfilled into
the queue or silently disclosed.

The current owner POSTs `article-proposal-candidates/:id/reviewer-resolution`,
using If-Match1, a new review UUID and1..100 distinct current eligible voter IDs.
The shared eligibility predicate is the existing article review predicate:
current OPEN account, workspace, project owner/member and projects.read. The head
must be the oldest explicitly submitted same-document candidate. All submitted
same-document contributions join the bundle before reviewer visibility; all
unsubmitted private stages remain excluded. More than100 fails closed and keeps
every contribution.

One transaction, under the existing Workspace lock, creates the frozen review and
fixed reviewers and marks all included candidates revision2/REVIEWER_RESOLUTION.
That committed visibility is the freeze cutoff, rather than a first read,
notification or acknowledgement. A simultaneous push either joins that exact
bundle or remains queued, with no partial inclusion. Later changes cannot modify
reviewed content. An active or decided-but-unpromoted review blocks later dispatch.
REJECTED and RETURNED_FOR_REVISION reviews retain their evidence and allow the
next accepted submission to proceed; their old candidates are never resubmitted
automatically.

## Exact alternatives and the six explicit routes

Materialization processes immutable contributions in accepted order, combining
nonoverlapping title, text and whole-forest changes. Equal values retain every
contributor. Only a strictly newer revision of the same author's same private
article lineage supersedes that author's earlier intent; the older contribution
is retained as evidence. Cross-author, different-source and equal-revision
alternatives are not silently replaced. The forest remains an atomic structural
field, using existing multiple-root, full-identity, parent/cycle/depth and explicit
Previous/Next order validation. No line-level merge is inferred.

Conflicting fields retain all stable alternatives and contribution IDs. A
conflicting materialization has comparison:null, preventing an invented winner.
For an unambiguous binary conflict, the ballot exposes two complete immutable
before/after comparisons A and B, consistently bound to their competing
contributions in accepted order. Nonconflicting merged fields are shared between
them; conflicting title/text/forest fields come from the same named alternative,
never a voter's unreviewed per-field hybrid. A/B labels and contents cannot change
between rounds. This supports a precise change UI; no frontend is implemented.

GET `article-resolution-reviews` returns up to50 owner/selected-reviewer metadata
rows, with an accessible UUID continuation and no raw ordinal, hidden count or
preference. GET `article-resolution-reviews/:id` exposes materialization, frozen
A/B comparisons, fixed reviewer IDs, derived round/outcome and only the caller's
own preferences and ballot history. Authorship alone grants no combined-review
read. Unrelated readers/editors cannot discover the review or use its identity as
a private paging anchor.

PUT `article-resolution-reviews/:id/choices` retains the earlier nonbinding
reviewer preference API. Complete alternative choices append immutable history
under own choiceVersion If-Match; identical current preferences are a no-op.
Only selected reviewers can choose, with no owner override. Preferences are never
votes and close once any immutable ballot starts.

POST `article-resolution-reviews/:id/ballot` accepts one exclusive option and
round1 or2 (default1), with own ballot If-Match0. Only selected reviewers vote.
Each reviewer has one immutable ballot per round. Identical initial-revision
retries reread the existing ballot and return current derived state; changing
that ballot conflicts. Premature rounds, eliminated options and a third round
are rejected. A lost acknowledgement never triggers automatic replay. The
Workspace lock serializes concurrent final ballots/retries and commits the final
ballot and review phase together.

All six routes have bearer guards, explicit bounded DTOs, strict input handling
and no-store. Current OPEN account, workspace, project ownership/membership and
capability are checked again within every service transaction. Archived/deleting
projects reject writes. Revocation does not silently remove a fixed voter or
erase evidence. Known read availability and uncertain mutation outcomes retain
the existing sanitized503 classification; unknown failures retain500.

## Outcomes and the published-model boundary

PENDING and RUNOFF_PENDING retain RESOLVING. A winner PUBLISH_A/PUBLISH_B/KEEP_BOTH
produces DECIDED, with its exact frozen comparison(s) still available. REJECT_BOTH
produces REJECTED. An ambiguous cutoff or failed runoff produces
RETURNED_FOR_REVISION, with the reason recorded in the derived result. These are
deterministic functions of immutable ballots, not mutable cached tallies. No
binary conflict approval is added after the four-option decision.

KEEP_BOTH is represented explicitly by the winner tag and both independently
addressed complete A/B comparisons/provenance. It does not concatenate text or
erase authorship. Actual promotion remains disabled for every winner in this
slice: publicationAvailable:false and finalVotingAvailable:false report that
boundary. Legacy single-article review/voting APIs retain their prior behavior;
new resolution identities are not legacy ArticleReview identities.

Two source-backed representation boundaries remain before full publication:

- The current canonical ArticlePublishedVersion comparison holds one article
  title/text and one forest placement. Publishing KEEP_BOTH needs an explicit
  published variant/identity contract, especially if A and B place the same
  document differently. The retained two-comparison result is safe evidence,
  not a claim that both variants are already part of the shared published tree.
- Materialization can retain more than two competing contributions, or independent
  conflicts involving different pairs. Four named choices do not define which
  two complete alternatives should be placed in A/B in that case. Such reviews
  expose retained alternatives but reject ballots as MULTIWAY_CONFLICT; none is
  truncated, silently paired or picked by the owner. A selected multiway/pairwise
  rule is needed to support that case.

The current bounded encoder requires exactly two identifiable competing
contributions. Grouping equivalent submissions by additional authors is also
unimplemented engineering; that alone does not require a new product decision.

Canonical version/head/forest promotion, shared tree/Previous-Next reads, frontend
comparison/review wiring and production activation remain separate integration.
No real document was published. No ordinary editor publish button, restore,
media-disclosure policy or new permission was introduced.

## Storage, preservation and verification

Two additive migrations add three reviewer-resolution tables, three nullable
candidate submission/reference columns, then one per-reviewer/per-round ballot
table. There is no private-stage adoption, review creation, vote backfill, head
mutation or data rewrite. Positive counters, valid exclusive options and exactly
two permitted rounds are constrained. Review contents, choice histories and
ballots reject updates through permanent database triggers.

After one explicitly authorized identical startup retry, the fixture identity
was verified as profile_test/profile_test,127.0.0.1:55439, outside recovery. The
first migration preserved all85 old application-table projections; the ballot
migration preserved all88. Projections use pre-migration columns so additive
nullable fields do not create misleading digest differences. Both actual
migrations passed separate fully rolled-back scratch-schema tests, including
legacy candidate/reviewer preservation, no automatic adoption, valid rounds,
exclusive choices, duplicate uniqueness and immutable ballots. Schema parity
reports no difference.

Focused four-option/service/contract/HTTP tests passed50/4; the subsequent fault
and race HTTP run passed23/1 in21.643 seconds. The earlier82/83 HTTP attempt
remains recorded: its only failure was a synthetic owner lacking articles.edit,
so the guard correctly returned403 before the intended author-only404 test. The
fixture now grants only that synthetic owner the test capability; runtime code
was not weakened. The prior241/11 database-free and historical1,986/100 results
are not substituted for a current full regression. Final full-run/check/cleanup
results appear in the current verification record.

The final full regression passed **2,061 tests /105 suites** in546.726 seconds,
zero failures/skips, adding75 tests /5 suites to the1,986/100 foundation baseline.
It used the documented single128 MB-recycled worker, installed isolated-ts-jest
compilation and30-second Jest-only budget. Strict whole-project typecheck, lint,
format, build and schema validation/parity passed independently. Bash/ShellCheck
and all38 local deployment mock scenarios passed on the same commands through
approval-managed escalation after their sandbox MSYS failures. No application,
database or native-helper timeout/configuration was changed.

All14 final article/draft/review/ballot/scratch audit counts are zero; the exact14
permanent platform triggers match the migration-derived allowlist, with no fault
triggers. PostgreSQL was stopped after the full run. Cleanup and source hashes
are recorded in current verification; no new source change followed regression.

The original fixture-start denial and the unsuccessful sandbox-only HTTP/Bash
attempts remain documented. No destination or method was changed to evade the
denial. The identical fixture retry required new relevant authorization evidence
and succeeded once. Release checking remains independently blocked by the
pre-existing staged deletion of Docs/backend-release-catalog.json; the index and
that deletion remain untouched.
