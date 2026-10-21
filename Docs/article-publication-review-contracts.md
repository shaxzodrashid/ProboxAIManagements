# Reviewed article publication — 20 October 2026

This increment extends the individual plain-text draft foundation. The trusted
user decisions are: the project owner chooses voters; every listed voter must
vote before any decision; at least60% affirmative approves, inclusively. Creation
and editing remain separate capabilities. No real content, live grants or
production activation are part of local verification.

## Submission, disclosure and identity

An editor explicitly submits **one own draft article**, supplying a UUIDv4 review
identity and the exact quoted individual draft-space `If-Match`. Submission copies
only version1 plain-text article identity/title/text plus its source revision into
a retained review. It does not share the private space, other drafts, hierarchy,
sibling identities, reading sequence, future fields, media or historical snapshots.
Unsupported retained draft formats fail closed without rewriting them.

Submission makes that frozen article available to its author and the current
project owner, then to the owner-selected voters. Unrelated current members cannot
read or list pending/rejected reviews, even with broad administrative grants.
Project files/search/media do not gain access to private or submitted content.
Text and URLs remain inert plain text; no provider or media lookup occurs.

An approved submission becomes a project-readable publication **of that immutable
snapshot**, keyed by review identity. Publication reads omit the electorate,
individual votes, author profile and internal timestamps. Unrelated draft content
remains private after approval. Later draft edits neither change nor revoke what
was reviewed. Distinct reviewed submissions remain distinct; this increment does
not merge private forests into a shared tree, overwrite a previous publication,
select a latest-version policy, or implement version restore. The existing private
multiple-root forest and independent Previous/Next sequence remain unchanged.

One review exists per project/author/article/source revision. Explicit duplicate
identities or duplicate submissions of that exact source revision return409 without
changing the existing review. A new draft revision can be submitted separately.
This is reconciliation by stored identity/revision, not automatic write replay or
an exact request-receipt guarantee.

## Authority and state transitions

Every service entry point locks the existing Workspace row, reloads current OPEN
account/capability, and requires the current project owner or current membership
in the actor's current workspace. No workspace-administrator, read-all or
manage-all shortcut substitutes for resource admission. Archived projects retain
reads but reject submission, selection and voting; deleting projects reject writes.

`articles.edit` permits submission of an existing own draft, independently of
`articles.create`. Creation alone does not permit submission. Review/publication
reads, owner selection and selected-voter voting require `projects.read`; voting
authority is the explicit review electorate plus current project admission.
No new catalogue permission, built-in default, seed grant or live access mutation
is introduced. Voters acquire no draft creation/edit authority.

| State/action               | Required authority                                                       | Result                                                       |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Submit own draft           | Current member/owner with articles.edit and exact source revision        | WAITING_VOTERS, review revision0                             |
| Set voters once            | Current project owner with projects.read and review revision0            | PENDING, revision1                                           |
| Cast an uncast listed vote | Current admitted OPEN voter with projects.read and exact review revision | Increment revision; remain PENDING while any vote is missing |
| Complete final vote        | Same selected voter authority                                            | APPROVED iff yes*5 >= electorate*3; otherwise REJECTED       |

The owner chooses1–100 distinct UUIDv4 voter identities. At selection each must be
an OPEN current project member/owner in the same workspace with projects.read.
Unknown or ineligible identities return the same sanitized404; selection is atomic.
The owner may explicitly select themself but has no automatic vote or override.
There is no selection replacement, exclusion, cancellation, deadline, vote editing,
early approval or early rejection endpoint. Zero voters cannot decide a review.

The selected electorate is fixed. Losing membership, capability or OPEN status
blocks that person's subsequent reads/votes and does **not** remove them from the
denominator or discard an already cast vote. A missing revoked voter's vote leaves
the review pending; no automatic bypass is invented. Ownership transfer changes
who may choose a not-yet-selected list and inspect submitted reviews, but cannot
change a frozen electorate or override a decision.

Votes are retained once cast, including false votes, with internal timestamps.
Every listed vote counts. A complete3/5 approves,2/5 rejects,2/3 approves; reaching
three yes votes out of five still stays pending until the other two vote. Even
certain mathematical failure stays pending until the electorate completes.
The bound makes exact small-integer arithmetic sufficient; no floating rounding,
quorum, abstention removal or role weighting exists.

## HTTP and revision contracts

Routes under `/projects/:projectId` use bearer guards, explicit allowlisted DTOs,
strict body/query validation and `Cache-Control: no-store`.

| Method/path                          | Contract                                                              |
| ------------------------------------ | --------------------------------------------------------------------- |
| POST article-reviews                 | Body id/articleId; If-Match is the individual's draft-space revision  |
| GET article-reviews                  | Author/owner/selected-voter review metadata only                      |
| GET article-reviews/:reviewId        | Involved actor's frozen article and fixed voter list/votes            |
| PUT article-reviews/:reviewId/voters | Body voterIds; current owner only; If-Match is review revision        |
| POST article-reviews/:reviewId/votes | Body approved:boolean; listed voter only; If-Match is review revision |
| GET article-publications             | Approved submission metadata for current project members/owner        |
| GET article-publications/:reviewId   | Exact approved text/source revision; no electorate or private tree    |

Lists return at most50 allowlisted items and `nextAfter` (null at the end).
Optional `after` is a UUIDv4 keyset boundary in ascending review-id order. Lists
are live authorized views, not frozen chronological feeds; there is no hidden
total, raw database cursor lookup, foreign-row existence probe or cursor grant.

Missing/invalid If-Match retains existing428/400 behavior. Stale source/review
revisions return STALE_REVISION409; already-selected lists, repeat/changed votes
and terminal actions return ARTICLE_REVIEW_STATE_CHANGED409 when current revision
is supplied. Unadmitted resource identities return404. Unknown future snapshot or
inconsistent retained state returns ARTICLE_REVIEW_FORMAT_UNAVAILABLE409 without
content/metadata leakage or rewrites. Reads use the established sanitized
READ_DEPENDENCY_UNAVAILABLE503 wrapper. Mutations retain databaseOperationError
semantics, including OPERATION_OUTCOME_UNKNOWN503; they never reuse the read wrapper.

## Concurrency and preservation

The shared Workspace lock serializes current authority, draft revision checks,
submission snapshots, electorate selection, vote changes and final decision with
the existing draft/authority mutations. A vote and its review revision/decision
commit in one database transaction. Competing same-revision votes or selections
have one winner; the stale actor must reread and reconcile before retrying. A
decision-persistence failure rolls back the vote. A lost commit acknowledgement
can leave a completed decision; the caller gets an uncertain-outcome response and
must reread. There is no automatic retry, external publication effect or worker.

Additive migration `20261020070000_article_publication_review` adds an enum and two
tables. It rewrites/backfills no old data and grants/publishes nothing. Stable
original project/author/article keys, submitted bytes, fixed voters and votes
survive live project/user deletion; only the nullable project reference is nulled.
Every read still resolves a current project and actor. There is no orphan access,
reassignment, deletion, pruning, destructive rollback or restoration API.

## Verification and remaining scope

The final frozen-source full regression passes1,802 tests /94 suites with zero
failures/skips in355.497 seconds. The final focused run passes180 tests /7 suites
with zero failures/skips in108.102 seconds.
It includes malformed non-string voter IDs returning400, exact threshold/missing-vote
coverage, current authority and private isolation, real separate-client races and
lost decision acknowledgements. See `article-publication-review-verification-20261020.json` for exact final counts,
commands, hashes and fixture cleanup. Tests use generated synthetic text/identities
only. The actual migration is also exercised in a fully rolled-back scratch schema,
checking representative legacy values/counts/grants/audit/drafts/revisions, absence
of automatic review/publication backfill, and retention after live-reference deletion.

Shared published forest integration/latest-version selection, rich blocks, media
disclosure, version-history disclosure/restore, reviewer-list amendment/cancellation,
frontend wiring and production activation remain separate. None is required for
this explicit immutable single-article review/publication flow. No directory
restore implementation, agent, presentation, Postman, upload, credential, paid call,
commit/push, deployment, production migration or live permission/security change is
included. All previous uncommitted work is retained.
