# Backend changelog

## 0.2.0 — stable release

- Promote the bounded backend contracts from `0.2.0-dev.1` and deployment tooling
  from `0.2.0-dev.2` to a stable package version. Preserve each feature's original
  introduction reference and foundation/supported scope.
- Support the existing ordered systemd environment-file list in the deployment
  CLI, including private-file validation, configuration checks and read-only
  candidate migration status. Retain the single-file configuration contract.
- Document the app2 baseline cutover, exact runtime paths and recovery procedure.
- Rollout from baseline `0.1.0` requires 20 database migrations, duplicate-draft and
  default-department preflight, a verified database backup, and coordinated shutdown
  of old writers/executors. Migrations add permission definitions without granting
  them to existing roles. No seed or automatic data reconciliation is included.

Release preparation is not proof of production deployment. See the
[rollout procedure](Docs/release-0.2.0-rollout.md).

## 0.2.0-dev.2 — deployment tooling checkpoint

- Linux/systemd CLI for help/status/logs, backend-only stop/resume and main-only
  restart/deploy through isolated build/test, read-only migration readiness,
  bounded health/version verification and known-good runtime rollback.
- Protect dirty/divergent source, serialize lifecycle operations, scrub build
  credentials and retain private diagnostics/failed candidates. No automatic
  migrations, seeds, service-unit edits or destructive schema commands.
- Bash syntax, ShellCheck and mocked/sandboxed lifecycle/configuration regressions
  are part of the actual precommit hook. Production service integration and
  operator-controlled one-time release-directory setup remain unverified.
- Archive release consistency validation supports manifests produced from verified
  Git commits without requiring a .git directory inside immutable release artifacts.

No production deployment or database migration was performed. Progress belongs to
dev; stable production release selection is separate. See [CLI contract](Docs/deployment-cli.md).

## 0.2.0-dev.1 — development checkpoint

First tracked backend gap checkpoint for dev; commit and tag only after verification.
Not deployed. The release tag identifies the actual implementation commit; this
entry records the implementation scope, not historical introduction dates.

- Self identity, independent creation/profile names, optional bio, profile audiences,
  directed contacts, private aliases and safe account discovery.
- Administrative lifecycle/role revisions; department/template validation and
  concurrency; typed command arguments and effective upload contracts.
- Durable project creation, enqueue recovery and deletion outcomes; archive and
  member-only human task visibility; permitted active-workspace member picker.
- Human task workflow statuses, assignments, checklists/deadlines/order, plain
  comments, priority and bounded filtered/sorted queries with scoped summaries.
- Durable session acceptance/replay/state, assigned-session index, saved execution
  context, initialization event recovery and canonical assistant text.
- Creator-only chat group metadata and creation receipt recovery. Conversations,
  invitations, agent identity and history delivery remain incomplete.
- Contract review removes worker paths/leases/raw errors from ordinary project
  initialization summaries and fixes case-insensitive deletion retry identity and
  concurrent request-reuse validation. File recovery remains partial for external
  writers and unselected restoration/expiry policies.
- Semantic version catalog, generated feature availability and precommit consistency
  checks. Release versions do not change /api/v1 compatibility routing.

See [feature availability](Docs/backend-feature-availability.md) for exact bounded
contracts and evidence. Verification is recorded in the commit message and local
contract review record; no production migration or deployment is implied.

## Baseline: package snapshot 0.1.0

Observed at `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. There were no release tags.
Historical feature introduction versions and deployment history are unknown;
this is a documented code baseline, not a fabricated historical release.
