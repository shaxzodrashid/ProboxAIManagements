# Article reviewer resolution — 20 October 2026

Current contract: [Article conflict ballots and one runoff](article-conflict-ballot-contracts.md).
Current evidence: `article-reviewer-resolution-verification-20261020.json`.
Full regression:2,061 tests /105 suites, zero failures/skips,546.726 seconds.
The earlier partially verified/blocked snapshot is retained as
`article-reviewer-resolution-contracts-20261020-blocked.md` and its verification
has the matching `-blocked.json` suffix.

Explicit author submission, FIFO bundling, atomic reviewer visibility, immutable
alternatives and exact complete A/B comparisons remain implemented. The later
user-approved policy supersedes the earlier aggregation question: four exclusive
choices, every fixed reviewer votes, inclusive60% wins; one unambiguous top-two
runoff uses the same electorate and60%. A tied cutoff or failed runoff returns
for revision. No unanimity, arbitrary tie-break, plurality or extra binary
conflict approval is implemented.

The identical isolated fixture startup retry succeeded after new authorization
evidence. Both additive migrations preserved existing fixture rows and passed
rolled-back upgrade checks; focused real HTTP and fault tests passed. The current
verification records the actual full-run result and cleanup. Full publication
integration remains incomplete: KEEP_BOTH published variant/placement semantics,
multiway A/B representation, canonical version/head/forest promotion, shared
published-tree reads and frontend wiring are not claimed complete. No actual
publishing, production migration, upload or deployment occurred. Release checking
still encounters the pre-existing staged catalog deletion, which is preserved.
