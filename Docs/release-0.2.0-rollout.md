# 0.2.x rollout from app2 baseline

Current target: **0.2.1**. The initial0.2.0 preparation stopped before migrations or
runtime changes because an unpinned Corepack invocation selected pnpm12.11.2 and
could not load its uncached launcher after a download prompt. The patch pins the
tested pnpm10.13.1 and supplies noninteractive Corepack settings. Preserve the
failed candidate/log and immutable v0.2.0 tag; use the new verified patch release.
Both versions have the same 20-migration delta from the production baseline.

This release promotes the existing bounded contracts and installs the tested
multi-environment-file CLI compatibility change. It does not claim that every
foundation feature is complete or that production deployment has occurred.

## Verified starting point

Operator readback during CLI setup established:

- The preserved `0.1.0` artifact is
  `/srv/proboxai/deploy/releases/baseline-31fdd5a`, selected by `current`.
- Its recorded source is `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`; observed
  public OpenAPI version is `v1`. These two version labels are deliberately separate.
- The actual service process runs from that baseline and local readiness reports
  ProboxAI, PostgreSQL and MinIO healthy. No new backend version was deployed by setup.
- Source checkout `/srv/proboxai/api` is clean on main at the original commit.
- Service user/group remain `proboxai:proboxai`. Node is `/usr/local/bin/node`.
  All five existing environment files remain external, required and ordered.
- Archive, uploads and workspace paths remain outside releases.
- The original unit configuration and setup files were retained privately at
  `/root/proboxai-cli-setup.J8UOwk`. The added drop-in is
  `/etc/systemd/system/proboxai.service.d/90-proboxai-deploy.conf`.

These are setup observations, not a guarantee that the host still has that state.
Recheck selection, source, resolved unit and readiness before rollout.

## Schema and writer cutover

There are 20 new committed migration directories after the eight-migration
baseline. The release adds names/bio and privacy/contact data, revision and
authorization tokens, file deletion/executor fences, durable session metadata,
project creation receipts, task boards/deadlines/archive/collaboration/priority,
and creator-only chat group metadata. It preserves legacy fullName verbatim and
does not infer assignees, historical human tasks, profile audiences or role grants.

Before any write, independently read the production `_prisma_migrations` ledger
and run [the read-only preflight](mutation-revisions-preflight.sql).
Duplicate DRAFT versions block the unique index. An inactive default department
requires deliberate reconciliation before validation. Do not delete/publish drafts
or change department status automatically. Report exact blockers for an operator
decision; the normal upgrade path assumes the preflight returns no blockers.

Identify PostgreSQL container/database/role from the existing deployment without
printing credentials. Create a private custom-format `pg_dump` backup and verify
its archive with `pg_restore --list`; retain the exact backup path and checksum.
Use PostgreSQL tools compatible with the server. A successful file listing is not
equivalent to a restore rehearsal; record which verification actually ran.

Prepare and test the immutable stable candidate with scrubbed build credentials
before downtime. Coordinate clients for required turn request/interrupt identifiers
and changed event replay semantics. Stop the backend and confirm that all old
workers/executors and any other writers are quiescent before the final backup,
preflight and explicit `prisma migrate deploy` from that candidate. Never run
`migrate dev`, reset, bootstrap seeds or ad-hoc duplicate cleanup in production.

After migrations, require no pending/failed ledger entries. Check and explicitly
validate `Department_default_must_be_active` only after its data preflight passes.
The migration intentionally creates this CHECK as NOT VALID; a successful migrate
command alone does not establish historical constraint validity.

Start the new candidate through the guarded CLI and require local dependency
readiness plus Swagger `info.version=0.2.1`, exact selected source and the actual
process working directory. Independently verify public readiness through the
configured public hostname. Do not announce deployment based only on Git version,
build output, database readiness or a symlink.

## Recovery boundary

Preserve the original code/dependencies, failed candidate and private diagnostics.
The CLI can restore runtime selection; it never reverses schema/data changes.
Assess baseline compatibility before resuming it after migration, and quiesce the
new binary first. New tables/columns and enum additions are additive, but legacy
writers bypass revision/lease guarantees and new CHECK/unique constraints also
apply to them. Do not promise mixed-writer safety or automatic prompt replay.
Never drop the new schema or restore a database backup over newer production
writes as an automatic runtime recovery action.

## Local preparation evidence

An isolated PostgreSQL18 cluster was created for this release; no production data
or credentials were copied into it. The full 28-migration chain applied to a fresh
test database. A separate upgrade database received the original eight migrations
from commit `31fdd5a`, legacy identity/project/task/session/turn/event/template
fixtures, then all 20 new migrations under a non-superuser database owner.
Assertions confirmed unchanged legacy fullName/prompt/event data, null unguessed
name components, version0 legacy event projections, one new four-column board per
project and no inferred legacy task-board membership. The explicit department CHECK
validation succeeded afterward, pg_trgm was installed by the non-superuser owner,
and Prisma schema comparison reported no difference. Global lint and Nest build
passed. This PostgreSQL18 rehearsal differs from the observed production17.11 host;
the actual migration ledger and dependency health must still be verified there.

The release preparation gate passed 38 deployment sandbox scenarios, TypeScript
typecheck and all 887 tests across 51 suites with the isolated database enabled;
no Jest suites/tests were skipped. Staged ESLint/format checks and release metadata
consistency passed as part of `pnpm precommit`. Synthetic failure-path log messages
are test evidence, not reported production incidents.
