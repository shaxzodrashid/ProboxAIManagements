# Backend changelog

## 0.2.3-dev.1 — profile Contact revocation correction

- Remove caller-owned directed Contact grants and private aliases with
  case-insensitive UUID matching. A valid uppercase or mixed-case DELETE can no
  longer report success while leaving Contacts-only biography or birthday access.
- Revoke matching historical text spellings without rewriting account identities;
  preserve other owners' Contacts and all separately selected audience policies.
- Cover actual HTTP/PostgreSQL redaction after removal, repeated requests,
  historical references, authentication and validation. No schema migration or
  new profile/status/default policy is introduced. See
  [contract and verification](Docs/profile-contact-revocation-contracts.md).

Local development checkpoint only. No push, deployment or production action.

## 0.2.2 — concurrent profile test-server lifetime

- Give the self-profile HTTP suite an explicitly listening loopback server for its
  entire lifetime. Supertest no longer owns a temporary listener that it can close
  after the first response while the eight-request batch is still in flight.
- Await every concurrent read with allSettled before asserting success, preventing
  pending reads after a transport failure from consuming a later test's one-shot
  authentication mock. Preserve all response, side-effect and strict404 assertions.
- Address app2's Node22 preparation failure in the concurrent status read and its
  following workspace-change check. Preparation stopped before migrations or a
  runtime switch; the 0.1.0 backend remained active.

This patch changes test infrastructure and release metadata, with no API or schema
change. The original 20-migration rollout and immutable earlier tags are preserved.

## 0.2.1 — deterministic deployment package manager

- Pin `pnpm@10.13.1`, the version used by local release verification, in
  package.json so an immutable candidate cannot select an unrelated global version.
- Pass noninteractive Corepack download settings through the scrubbed preparation
  environment, disable latest-version lookup and automatic package metadata edits,
  and assert those settings in the deployment sandbox.
- Address app2's failed 0.2.0 preparation: Corepack selected pnpm12.11.2, prompted
  for download and then could not find its cached launcher. The failure happened
  before production migrations or a runtime switch; the 0.1.0 baseline stayed active.

This patch adds no schema migration. The original 20-migration rollout still applies.
The immutable `v0.2.0` tag is preserved.

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
