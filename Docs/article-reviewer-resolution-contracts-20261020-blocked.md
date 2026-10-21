# Article reviewer alternatives — 20 October 2026

Status: local, uncommitted implementation with database-free verification. This
extends the 1,986-test proposal foundation; it is not a completed publication
queue. No migration has been applied in this increment and no real content has
been published. Older evidence and staged changes are preserved.
Sanitized current evidence is in
`article-reviewer-resolution-verification-20261020.json`.

## Settled authority and remaining decision

Conflicting contributions must both remain available and reviewers decide.
Automatic owner resolution and first-reviewer-wins are not authorized. The owner
still selects the fixed eligible reviewers. Final publication still requires
every listed voter to vote and at least60% approval. The rejected reconcile-and-
revote proposal is not an outstanding question.

The one essential remaining decision is how differing choices by selected
reviewers yield the single resolved snapshot on which final voting begins.
Recommendation only: require all selected reviewers to agree on the complete
resolved snapshot before final voting. No unanimity, majority, owner tie-break,
deadline, reviewer replacement or automatic final-vote transition is implemented.
Even a conflict-free bundle remains in RESOLVING in this slice.

## Lifecycle and API contract

Staging remains private to its author and current project owner. An author must
explicitly submit a staged contribution; the owner cannot submit another person's
private stage. `POST article-proposal-candidates/:id/submit` requires current
articles.edit, current project access and candidate If-Match. It allocates an
accepted submission ordinal independently of staging order, returning revision1
and QUEUED_FOR_REVIEW. Retrying revision0 after success conflicts; reread the
candidate identity after a lost acknowledgement. No automatic retry occurs.

The current owner calls `POST article-proposal-candidates/:id/reviewer-resolution`
with If-Match1, a new review UUID and1..100 distinct currently eligible voter IDs.
Eligibility is shared with the existing single-article review service. The head
must be the oldest explicitly submitted candidate for that document. All submitted
same-document candidates before this transaction commits join the frozen bundle;
unsubmitted stages remain private. More than100 contributions fail closed without
silently dropping any. A current active resolution blocks later dispatch.

The Workspace lock serializes cooperating submissions, dispatch, authority changes
and reviewer preferences. Creating the immutable review and fixed reviewer list,
then changing all included candidates to revision2/REVIEWER_RESOLUTION occurs in
one transaction. This committed reviewer visibility is the freeze cutoff. Later
pushes remain queued and cannot change the materialization under review. No
notification, first-read timestamp or delivery acknowledgement determines cutoff.

GET article-resolution-reviews lists at most50 owner/selected-reviewer metadata
items. A UUID continuation must itself resolve in the same authorized scope; raw
ordinals, hidden totals and preferences are omitted. GET .../:id exposes frozen
materialization, fixed reviewer IDs and only the caller's own preference version
and choices. Authorship alone does not grant access to the combined bundle.
Unrelated members/editors remain excluded. Current OPEN account, workspace,
project membership/ownership and projects.read are checked again on every call.
Archived/deleting projects reject writes. All new routes use explicit DTOs,
strict bounded validation, bearer guards, If-Match on writes and no-store.

PUT .../:id/choices accepts exactly one retained alternative per conflict, with
If-Match for that reviewer's own choiceVersion. Only selected reviewers can write;
an unselected owner cannot choose. Each change appends immutable choice history
and advances only that person's pointer. An identical payload at the current
version is a no-op. A stale version conflicts. Different reviewers may retain
different choices simultaneously; neither overwrites the other or changes review
content. Revocation blocks future access without silently modifying electorate
or evidence. No other reviewer's preferences are disclosed through these DTOs.

## Materialization, provenance and preservation

Immutable contributions are processed in accepted submission order. Nonoverlapping
title, text and whole-forest changes combine. Different values for a field remain
explicit alternatives with stable content IDs and the contributing identities;
equal values retain all contributing identities. Only a strictly newer revision
of the same author's same private article lineage supersedes that author's older
intent; the older immutable contribution remains listed as superseded evidence.
Equal-revision structural alternatives, different source articles and every other
author's contribution remain available. No line-based merge or cross-author
replacement is inferred.

The review retains exact immutable before bytes and fields/alternatives. A fully
nonconflicting materialization also includes an exact validated before/after
comparison. Conflicting fields are null and comparison is null, preventing a UI
from presenting an invented winner. The forest is an atomic structural field;
multiple roots, valid parent links, full identity preservation and explicit
Previous/Next order use the existing validators. Unsupported formats or
incompatible published structure fail closed with all contributions preserved.
This is backend comparison data; no change-review UI is implemented.

The additive migration introduces three resolution tables and three nullable
candidate columns, with no backfill or adoption of old private stages. Positive
counters and immutable review-content/choice-update triggers supplement existing
contribution and approved-version immutability. Old approved bytes, canonical
heads, published forest and legacy review/vote routes are not mutated. The new
resolution has no legacy ArticleReview row: old voting endpoints cannot vote it.
All responses report finalVotingAvailable:false. The older candidate field
dispatchAvailable:false remains for compatibility; the new owner resolution
endpoint is distinct from the still-disabled final-publication bridge.

## Verification and exact blockers

The initial database-free run passed202 tests /8 suites in38.700 seconds. After
adding explicit author-submit unit coverage, the final changed-area run passed
62 tests /4 suites in7.987 seconds. These overlapping counts must not be added.
All article database-free suites then passed241 tests /11 suites in26.677
seconds, zero failures/skips. Whole-project TypeScript checking, lint, formatting,
build and Prisma validation passed. A broader run encountered connect EACCES
localhost denials in existing authentication/authorization/profile HTTP tests and
was interrupted; it is not a completed or passing regression. See the local
article-resolution logs/evidence under artifacts. The new11 HTTP/persistence tests are prepared
but unexecuted; SQL preservation, concurrency, triggers, rollback, parity and a
full database-enabled regression remain unverified for this increment.

The exact blocked action was starting the existing isolated fixture:

```text
pg_ctl start -D C:\Users\user\AppData\Local\Temp\proboxai-atomic-profile-pg-20261016\data -l C:\Users\user\AppData\Local\Temp\proboxai-atomic-profile-pg-20261016\server.log -o '-h 127.0.0.1 -p 55439'
```

Automatic approval review denied this action before execution, citing an earlier
read-only assessment and calling this reviewer-resolution migration/test slice
unauthorized. No retry, alternate host/method, migration or database connection
was performed afterward. Newly relevant scope clarification is needed before one
bounded retry of the identical start action; the fixture remains stopped.

The release check encounters ENOENT for Docs/backend-release-catalog.json, whose
deletion was already staged on entry. It was not restored or replaced. Both local
deployment check scripts fail before their scenarios because installed Git Bash
cannot create its MSYS named directory object (0xC0000022). This establishes
neither ShellCheck success nor38 passing mock scenarios in this increment; no
runtime/security workaround was attempted. No actual deployment was requested.
The fresh368-file source baseline retains361 files byte-identically; the seven
changed existing files are the article services/DTO/module, Prisma schema and
the proposal test/harness integrations. None is missing. New resolution files
are additive. The repository index was not modified. Owned Jest caches were
removed after workspace containment/reparse checks, the interrupted runner was
terminated and the final pg_ctl status confirms no server running.

## Remaining integration

After the resolution aggregation decision: derive/validate the agreed complete
snapshot, freeze it for final all-voters-complete voting, then implement atomic
approved immutable version/provenance/head/forest promotion and FIFO advancement.
These paths remain disabled, not inferred from recorded preferences. Stable
canonical published reads/Previous-Next integration, frontend comparison/review
wiring and production activation remain separate work. No production migration,
live permissions, Postman, upload, credentials, paid calls, commit/push/deployment
or real article publication occurred.
