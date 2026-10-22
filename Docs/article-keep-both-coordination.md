# Article keep-both comparison and coordination

First tracked release: 0.3.3. This extends the existing
[conflict ballot contract](article-conflict-ballot-contracts.md) and
[canonical publication contract](article-canonical-publication-contracts.md).
The older dated verification documents describe their original checkpoints.

## Combined comparison

Before a binary conflict reaches reviewers, the server computes and stores one
immutable `combinedComparison`. KEEP_BOTH publishes that exact validated result
under the existing fixed-electorate voting and canonical promotion rules, without
a second approval. Complete A/B alternatives and contributor history remain.

Title and text use bounded exact line comparison. Shared content appears once;
distinct contributions are retained in accepted alternative order. Compatible
parent changes and an unchanged or unambiguously changed reading order can merge.
Conflicting placements, conflicting reading orders, excessive comparison work or
oversized combined text/title fail before reviewer visibility. No truncation or
arbitrary winner is used.

Retained reviews without a stored combined preview reject a new KEEP_BOTH ballot
with `ARTICLE_KEEP_BOTH_PREVIEW_UNAVAILABLE`. No preview or ballot is backfilled.

## Pending submission limits

Only a strictly newer revision of the same author's private article lineage
supersedes an earlier active version for counting. Historical snapshots remain.
At most two authors and two active versions can enter a new conflict review.
Exceeding either limit atomically marks the pending same-document batch
`REJECTED_FOR_COORDINATION`, with `AUTHOR_LIMIT` or `VERSION_LIMIT` and revision 3.
Drafts and contribution history are retained. The response asks participants to
coordinate one combined submission; it does not resubmit or publish on their behalf.

Staging and readback expose an opponent warning when other authors have submitted.
Unsubmitted private candidates remain excluded. Submission and reviewer visibility
serialize under existing workspace coordination, so a racing submission either
joins the pending batch or remains separate from an already frozen review.

## Persistence and verification

The two 20261021 migrations add nullable coordination fields and a nullable combined
comparison, enforce valid coordination state and a non-null rejection reason, and
protect rejection records and combined previews against updates. Existing rows
retain null values. No data backfill or seed is performed.

Behavioral coverage is in `test/article-keep-both.spec.ts`,
`test/article-resolution.spec.ts` and `test/article-resolution.http.spec.ts`.
HTTP/persistence tests require the isolated `PROFILE_TEST_DATABASE_URL` fixture;
a database-free test run does not establish those guarantees.
