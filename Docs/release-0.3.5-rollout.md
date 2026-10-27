# Stable backend 0.3.5 preparation and rollout

Prepared on 27 October 2026 from local HEAD and independently read remote main
`c43074005804f13858ec4b69b41f1ddee677f363` (0.3.4). Remote v0.3.5 did not exist
at preparation. The candidate includes the pending task-board and project-roster
implementation. Package version, changelog, catalog and generated availability
identify 0.3.5. Preparation does not establish publication or deployment.

## Compatibility and client acceptance

Task queries default to original-only scope. Clients opt into `scope=all` for
original and shared cards, and `sort=position` for persisted ordering. Shared
cards use destination-local status and placement; assignment and owner authority
remain distinct. Canonical completion is explicit owner confirmation, independent
of the column name or checklist progress. Existing API paths remain `/api/v1`.

Manual moves accept optional `beforeTaskId`, retaining task revisions and request
recovery. Omission retains same-column order and appends on a column change;
explicit null appends. Conflicts require fresh readback and reconciliation.

Board SSE is an invalidation feed, not an audit replay: each active connection
polls persisted state every second, and changes may coalesce. Requery on initial
connection, invalidation and reconnect. Assess database/proxy capacity before
broad activation. Profile metadata changes need a fresh REST read.

Project rosters are returned to members or projects.read-all callers; public-read
nonmembers do not receive the roster. Project-list photos additionally require
projects.read-all and profile AVATAR audience access. Task assignee avatars use
their own current audience checks. Null/denied avatars require a client fallback.

Deploy backend and browser proxy together. Verify cookie authentication, CSRF,
current membership, permission denials, original/shared queries and moves,
revision conflicts, retry recovery, avatar privacy, canonical completion and SSE
reconnection/revocation with the integrated frontend. See [Tasks](frontend/tasks.md)
and [Projects](frontend/projects.md). Backend release preparation does not prove
frontend implementation or production acceptance.

## Database upgrade from 0.3.4

Exactly one migration is added: `20261027150000_task_card_positions`.
It adds `position INTEGER NOT NULL DEFAULT 0` to `TaskBoardEntry` and
`TaskSharedBoardEntry`. Existing cards initially tie at zero and use deterministic
creation/ID ordering until placement normalizes a column. No business records are
deleted and no new dependencies, grants or environment settings are introduced.

The candidate requires these columns and a regenerated Prisma client. Inspect
the real production baseline and pending migration delta, take and verify a
private PostgreSQL backup, quiesce writers, and apply the candidate migration
using the service's exact ordered environment files. The deployment wrapper
checks migrations but never applies them. Never run migrate dev/reset or seeds
against production. This two-statement SQL file has no explicit transaction;
inspect schema and migration ledger after any failure before choosing recovery.
Verify both columns, defaults and nullability, and all 54 migration checksums and
completion states before runtime activation.

## Local verification

Fresh release preparation checks on 27 October 2026:

- `pnpm release:check`: 56 bounded contracts and synchronized generated docs.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` and changed-document formatting.
- Compiled `backendReleaseVersion` and package version both equal `0.3.5`.
- `pnpm deploy:check`: Bash syntax and ShellCheck passed.
- `pnpm deploy:test`: all 38 sandbox deployment scenarios passed.
- `git diff --check`.
- Disposable loopback fixture identity verified as `profile_test` on port 55439;
  all 54 migration checksums/completion states match source, both new integer
  columns are non-null with default zero, and Prisma schema diff reports no
  difference.

- Full regression against that isolated fixture: 113 suites and 2,149 tests
  passed, zero failures or skips (503.736 seconds), including browser board,
  avatar transport, original/shared task and rolling-auth coverage. The owned
  PostgreSQL fixture stopped successfully in the runner's `finally` cleanup.

Local logs and the implementation/test file fingerprint inventory are under
`artifacts/release-0.3.5-*` (ignored by Git). They are local evidence, not immutable
CI attestations. The earlier task-board checkpoint is supporting history only.
No production migration, configuration change or frontend acceptance was performed.

## Publication and operator sequence

1. Review the complete candidate, including currently untracked implementation,
   tests, frontend guidance and migration. Recheck remote main before publication.
2. Run repository checks, commit the candidate, then create an annotated v0.3.5
   tag at that exact commit. Run `pnpm release:check -- --published`. Never
   overwrite existing tags.
3. Publish the verified commit to main with its tag and independently read back
   remote main and the peeled tag. Preparation alone does not publish either.
4. On app2 use the [configured wrapper](deployment-app2.md) to prepare the
   candidate. Resolve the inspected migration gate with the backed-up, quiesced
   procedure above, then activate with:

   ```bash
   runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
   ```

5. Require `Deployment healthy: 0.3.5`; independently verify selected and actual
   process release, dependency readiness and public OpenAPI version 0.3.5, then
   perform the integrated client acceptance checks above.

## Rollback constraint

Runtime rollback does not undo schema or authentication state. Retain the additive
columns and verified backup; do not reverse the migration as routine rollback.
Version 0.3.4 lacks the new board/proxy contract and will not maintain card
positions, so coordinate client fallback before reverting runtime. Preserve the
rolling-session/device-revocation guarantees from 0.3.4; older incompatible
authentication runtimes remain unsuitable while managed families are live.
