# Backend changelog

## 0.3.4 — rolling browser sessions and device authentication

- Add explicitly opted-in rolling browser sessions with a default 90-day
  inactivity window, foreground activity renewal and no default calendar cap.
  Clients without the rolling policy header retain capped browser sessions.
- Rotate browser-managed refresh credentials atomically, retain consumed hashes
  for replay detection, and support retained encryption keys during key rotation.
- Add owned-device listing/revocation, account-wide revocation and current device
  checks for newly issued JWTs and both persisted SSE paths. Direct-client refresh
  retains its existing fixed, nonrotating contract.
- Require recent authentication for sensitive administration and device revocation;
  add password confirmation and session-bound Telegram OTP confirmation for
  passwordless accounts without introducing a new login or password bypass.
- Document client activity/deadline handling, step-up, retention and rollback gates.

Two additive migrations are required relative to v0.3.3. Existing sessions retain
their deadlines; frontend rolling-policy integration remains a separate gate.
See [rollout notes](Docs/release-0.3.4-rollout.md). Preparation and Git publication
do not prove production deployment.

## 0.3.3 — browser authentication and article coordination

- Add anonymous browser registration and password recovery through existing OTP
  validation, with encrypted server-side purpose tokens and session-bound handles.
  Retain Origin, CSRF, JSON and original account authorization requirements.
- Allow browser project creation submissions, outcome readback and read-only
  department/template selectors; document authentication and project flows.
- Freeze and validate one combined article comparison before KEEP_BOTH voting.
  Preserve common text once, exact contribution history and valid forest changes;
  reject incompatible or oversized combined results without truncation.
- Bound pending review batches to two authors and two active versions. Reject
  excess batches for coordination while retaining drafts, snapshots and history.
- Include the deterministic history-cursor tampering test from 0.3.2.

Two additive migrations are required relative to v0.3.1 and v0.3.2. Browser
sessions remain opt-in; publication does not activate production configuration.
Existing release tags remain immutable. See [rollout notes](Docs/release-0.3.3-rollout.md).
Git publication does not prove deployment.

## 0.3.2 — deterministic history cursor tampering test

- Change an actual authentication-tag bit in the group-history cursor rejection
  test, then encode the altered bytes canonically. Replacing the final characters
  with AA occasionally left a valid random token unchanged, causing a false
  failure during server deployment preparation.
- Retain key-rotation, version, round-trip, nonce, length and bound checks. Cursor
  encryption, validation and runtime behavior are unchanged; no checks are skipped.

No new migrations, dependencies or production configuration relative to v0.3.1.
Earlier release tags remain immutable. Publication does not prove deployment.

## 0.3.1 — bounded deployment test memory

- Run Jest in one child worker and recycle it after a suite exceeds the 128 MB
  idle-memory threshold. Remove runInBand, which retains the whole run in the
  coordinator process and prevents worker recycling.
- Transpile test files with isolated ts-jest compilation; retain the separate
  strict whole-project typecheck in both precommit and deployment preparation.
- Use the previously verified 30-second Jest case budget for native helper tests.
  No application, database or native-helper timeout or assertion is weakened.
- Apply this configuration to ordinary pnpm test, including server deployment
  preparation and local commit hooks. The 0.3.0 server attempt exhausted Node's
  roughly 2 GB heap during Jest before build, migration readiness or runtime cutover.

No runtime API, dependency, schema or deployment credential change. No new
migrations relative to v0.3.0; the 21-migration delta from v0.2.2 still applies.
The immutable v0.3.0 release remains preserved. Publication does not prove deployment.

## 0.3.0 — stable backend release

- Promote the merged development contracts to a stable package release, preserving
  their original tracked introduction versions and foundation/supported scope.
- Include task creation retry/readback, project-scoped session queries, current
  task assignee/workflow display, shared manual availability, atomic Profile Save,
  and case-insensitive Contact revocation fixes from the development checkpoints.
- Include the later browser session/CSRF boundary, durable session intent and
  follow-up recovery, current project authority, shared human tasks/checklists,
  group admission/text/history/reactions, article draft/review/publication
  foundations, and bounded file Trash recovery. Native directory restoration is
  limited to the documented Windows runtime and NTFS configuration.
- Restore the machine-readable release catalog from the committed feature
  availability document and explicitly track it despite the general Docs JSON
  ignore rule. Fresh checkouts now validate and regenerate the same release data.
- Correct the article regression assertion for a request made after account
  revocation: the existing authentication guard returns 401. Revocation during
  an already authenticated approval still returns 403; runtime behavior is unchanged.

There are 21 added migrations relative to `v0.2.2`. The production migration ledger,
backup, writer coordination and explicit migration procedure must be verified
before runtime cutover. Browser sessions remain opt-in; this release does not
activate unfinished agent domains or claim complete product workflows. Existing
development handoff statements describe their original checkpoints, not this
release's publication or deployment status. Git publication is not deployment.
See the [0.3.0 rollout notes](Docs/release-0.3.0-rollout.md).

## 0.3.0-dev.10 — verified API documentation handoff

- Export all 160 registered local operations and their source-derived DTO/security
  contracts without starting application services or running workflows.
- Prepare deduplicated documentation for the existing private Postman workspace:
  preserve 81 saved scenarios, add 80 missing operations, keep environment values
  and credentials untouched. Validate refs, placeholders and request templates.
- Record remaining product/security/storage decisions and backend/UI boundaries.

External synchronization is blocked by automatic approval review: the first
collection replacement was rejected and no write succeeded. The exact local
artifacts and pending plan are in [the API handoff](Docs/api/README.md).
No push, public publishing, deployment or production migration.

## 0.3.0-dev.9 — atomic Profile Save

- Add coherent edit read and guarded whole-Save commit/readback for profile fields,
  supplied privacy and optional shared manual availability in one transaction.
- Cover legacy and internal writers with an aggregate generation; preserve
  standalone status revision/errors and truthful human mutation history.
- Add minimal private root receipts for exact retries and unknown-outcome recovery.

Additive migration20261016020000 preserves existing content, policies and status
history. Frontend/Figma wiring and agent activation remain unfinished. See
[contract](Docs/atomic-profile-save-contracts.md) and [UI handoff](Docs/backend-ui-handoff.md).
No push, deployment or production migration.

## 0.3.0-dev.8 — shared manual availability and UI handoff

- Add self read/set/clear and public read for one shared Available/Away/Busy value.
  No selected default, audience-specific rule or automatic presence inference.
- Coordinate human writes with revisions, request receipts and truthful employee
  history; exact retries never overwrite a newer status. Agent execution stays off.
- Retain legacy STATUS audience metadata without applying it to shared availability;
  other profile privacy remains independent. Add the ongoing backend/UI handoff.

Additive migration20261016010000 has no user/policy/grant backfill. Custom text,
badge symbols, expiry and coordinated main-profile/status Save remain unfinished.
See [status contract](Docs/shared-manual-status-contracts.md) and
[UI impact](Docs/backend-ui-handoff.md). No deployment or live credentials.

## 0.3.0-dev.7 — inactive delegated bio domain foundation

- Model trusted employee/agent separation, exact manual approval, revision-safe
  bio changes, frozen replay and actual-actor history behind mandatory ports.
- Model separate content/privacy scopes, one-time owner permission snapshots and
  permanent downward removal; human overwrite clears the current AI badge.
- Missing identity or atomic persistence fails closed. No production adapters,
  routes, Nest registration, credentials or migration; current writers unchanged.

In-memory tests prove domain rules and simulated transactions only. Activation
requires real agent authentication, persistence, coordinated human writers and
permission-loss hooks together; no live functionality or checklist closure is
claimed. See [activation boundaries](Docs/delegated-bio-foundation-contracts.md).

## 0.3.0-dev.6 — task text limit compatibility

- Preserve existing creation limits on human detail edits: title240 and
  description16000, using shared limits and the same class-validator length
  semantics in DTOs and service guards. Valid existing Unicode text can round-trip.
- Keep checklist title200, execution-only criteria8000, title trimming and
  nonblank checks, ownership, revisions and frozen replay contracts unchanged.

This fixes TASK04's bounded text-limit compatibility gap. No migration, new
permission, provider or profile policy is introduced. See the
[text limit contract](Docs/task-text-limit-contracts.md).

## 0.3.0-dev.5 — recoverable task creation

- Add optional requestId to existing POST/tasks: same owner/workspace/key and
  canonical input replay the original201 task; changed reuse conflicts409.
- Atomically store a narrow frozen receipt with the task. Create-only owners
  can reconcile through GET/tasks/creations/:requestId without task-read grants.
- Preserve legacy no-key behavior, field limits and creator/execution-manager
  defaults. Recheck current creation authority under the workspace lock.

Additive migration20261016000000 adds opt-in receipts without backfill or grants;
fresh and legacy-data isolated migration checks passed. This closes TASK04's
bounded uncertain-create recovery subset, not new project-task creation or the
full Task Manager. See [recovery contract](Docs/task-creation-recovery-contracts.md).

## 0.3.0-dev.4 — task identity in project session queries

- Add current task identity/title and explicit board project ID only to the
  existing project-filtered assigned-session index. Reuse current project
  membership, session-read, assigned-manager and workspace checks.
- Preserve global/task-only summaries, session keyset ordering/cursors and saved
  execution context. Select only page task IDs/titles in the same snapshot;
  expose no project label, description, criteria or new capability guarantee.

This closes MAIN01's bounded project-session task-identity subset. Broader Home
feeds, project-label/capability composition and complete counts remain open.
No migration, new permission or agent/profile policy is introduced. See the
[task identity contract](Docs/project-session-task-identity-contracts.md).

## 0.3.0-dev.3 — public task assignee identities

- Include current allowlisted public names on fresh member-only human task
  detail, list and query items, shared by task and checklist assignee IDs.
- Reuse structured names and verbatim legacy display fallback, without private
  aliases, profile fields or invented avatar delivery. Retained inactive or
  foreign-workspace IDs have no hydrated identity.
- Preserve frozen mutation/audit responses, assignment eligibility and task query
  generation. Public identity is current per-page display metadata.

This closes the public-name read subset of TASK04/TASK05 only. No migration,
new grant or profile/status policy is introduced. See the
[assignee identity contract](Docs/task-assignee-identity-contracts.md).

## 0.3.0-dev.2 — human task workflow display

- Add current `workflowStatus` to member-only human task detail, compatibility list
  and bounded query items, sharing the board's allowlisted identity, label, semantic
  color, position and fixed palette. No additional board or management grant.
- Keep frozen mutation/audit responses and legacy execution-task contracts unchanged;
  no historical snapshot rewrite or runner-status inference.
- Match status-name validation to the existing 120-Unicode-code-point database
  boundary, preserving valid astral names and rejecting oversized presentation
  sequences before writes. Unknown display metadata fails unavailable.

This closes TASK02's resolved per-task workflow-display subset, with no migration,
new colors, publication, deployment or profile policy. See the
[workflow display contract](Docs/task-workflow-display-contracts.md).

## 0.3.0-dev.1 — explicit project-task session query

- Add an optional `projectId` filter to the existing assigned-session index,
  using the task's explicit board/project association and current project
  membership alongside existing assignment, workspace and session-read checks.
- Intersect task/status filters, bind project-scoped cursors to canonical identity,
  preserve unfiltered cursor compatibility and the existing minimal response.
  Saved execution project/cwd never substitutes for the board association.
- Verify membership/assignment/workspace revocation, archives, broad-grant denial,
  execution-context separation, validation and OpenAPI through isolated HTTP tests.
  No migration, new grant, runner action or production change is introduced.

This closes the bounded MAIN01 project-task query subset; broader Home feeds,
counts and action/capability composition remain incomplete. See
[project session query contract](Docs/project-session-query-contracts.md).

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
