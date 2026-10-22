# Stable backend 0.3.3 rollout

This release includes browser registration/recovery and keyed project creation
transport, frozen KEEP_BOTH article comparisons, pending article coordination
limits, frontend guidance and the 0.3.2 history-cursor test fix. The package,
changelog, catalog and generated feature availability identify 0.3.3. Existing
release tags remain immutable; publication is separate from production deployment.

## Database upgrade from 0.3.1 or 0.3.2

Exactly two migrations are added:

1. `20261021010000_article_keep_both_coordination`: nullable coordination reason
   and rejection timestamp on ArticleProposalCandidate, nullable combinedComparison
   on ArticleResolutionReview, coordination-state constraint and immutability triggers.
2. `20261021020000_article_coordination_reason_guard`: require a reason whenever
   a coordination rejection timestamp is present.

Both run in explicit transactions. Existing records remain null in the new fields;
no seed, deletion or content backfill is included. The first migration depends on
the existing `proboxai_article_immutable_snapshot()` trigger function. Verify the
actual ledger and schema before assuming the server is on the expected baseline.

The updated Prisma queries require the new columns. Coordinate backend and other
writers, take and verify a private PostgreSQL backup, stop and confirm writers,
then apply these migrations from the verified candidate with the service's exact
ordered environment files. Validate the migration ledger, columns, constraints
and triggers before activation. Never run migrate dev, reset or bootstrap seeds.
An older binary does not understand new coordination states; assess data and
writer compatibility before any rollback. Runtime rollback does not undo schema
or data changes.

## Operator sequence

Use the configured [app2 wrapper](deployment-app2.md), one inspected step at a time:

1. Read current service/release status and source state; confirm the published SHA.
2. Prepare the candidate with the normal deployment wrapper. Pending migrations
   stop it before runtime switching and leave the candidate for inspection.
3. Confirm candidate provenance and the exact pending migration set, then perform
   backup, writer quiescence, explicit migration and independent schema validation.
4. Run the normal wrapper again from app2's root shell:

   ```bash
   runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
   ```

5. Require `Deployment healthy: 0.3.3`, check selected/runtime provenance, and
   independently verify readiness dependencies and OpenAPI version 0.3.3.

The wrapper never applies migrations. Keep PostgreSQL, MinIO, environment files
and persistent workspaces in their existing locations. Browser sessions remain
opt-in with the existing origin/cookie configuration; deploying this release
alone does not enable them. Telegram/provider delivery is not established by
local synthetic tests.
