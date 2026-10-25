# Rolling authentication implementation checkpoint — 24 October 2026

## Final verification — fresh-task completion

This section supersedes all pending/running work statements below. The fresh task
reviewed the tracked diff, all seven untracked deliverables, migrations, server
contracts and saved verification evidence. No further runtime implementation change
was needed. Repository `.agents`, `.codex` and applicable ancestor `AGENTS.md` files
were absent. No sibling frontend was accessed, and no denied CIM query was retried.

### Independently checked evidence

- Parsed `artifacts/auth-full.json`: `success: true`, **2,137 passed / 110 suites**,
  zero failed/pending tests or suites. All **404 article tests / 19 suites** passed.
  The log agrees: 527.343 seconds, ending 24 October at 10:52:38 UTC. The saved
  affected confirmation agrees at **276 tests / 11 suites**. These completed suites
  were not rerun. Runtime source, schema, migrations and tests predate the full run;
  subsequent working-tree edits were documentation only. This is local evidence,
  not an immutable CI attestation or a production result.
- Reviewed the saved clean lint/typecheck/build/format/Prisma-validation output and
  aggregate logs: Bash/ShellCheck passed, **38** sandbox deployment scenarios passed,
  and the release checker verified **53** bounded contracts. `git diff --check`
  also passed in this task. No deployment command was executed.
- Ran `artifacts/auth-final-parity-run.ps1` against only the named fresh synthetic
  fixture. Prisma live-database-to-datamodel diff with `--exit-code` returned **0**,
  **No difference detected** (`artifacts/auth-final-schema-parity.log`).
- Final audit independently checked database/user/loopback/port identity, all **53**
  applied migration checksums against local SQL bytes, and found no missing,
  unfinished, rolled-back or checksum-mismatched migrations. Both new auth migrations
  are finished. All **18** noninternal public triggers are enabled and have names
  present in migration source; no unexplained test trigger remains. Prisma parity
  does not itself validate trigger/function bodies; the trigger check is a name and
  enabled-state audit, not a claim of complete SQL-body equivalence.
- Remaining rows are exactly the four original synthetic legacy seed identities:
  one workspace, user, refresh root and browser row. No refresh-credential, project,
  task or article-review rows remain. Legacy `managed`/`rolling` defaults remain
  false, authentication timestamps null and new attempt counters zero. Nothing was
  deleted or repaired. Details: `artifacts/auth-final-audit.json`.
- The runner stopped its owned database in `finally`; final `pg_ctl status` confirms
  **no server running** (`artifacts/auth-final-fixture-after.log`). No tests or
  services were started other than this brief synthetic schema audit.

Historical before/after original-column preservation was reported by the prior
worker for 90 and 91 tables. The reusable JSON was subsequently overwritten by a
before-probe, so it cannot independently prove those historical equality checks.
This task verified additive-only SQL, current migration checksums/schema parity and
the retained legacy rows/defaults. It does not claim to have re-proven the old
all-column fingerprints or preservation of the damaged historical fixture.

### Handoff and rollout limits

The complete changed-file list below remains accurate: 21 tracked modifications and
seven untracked deliverables. This task changed this checkpoint and ignored audit
artifacts only; unrelated work was preserved. A SHA-256 inventory is saved in
`artifacts/auth-final-verification-manifest.json`; ignored artifacts are local
evidence and are not automatically part of a future commit.

There is no remaining backend verification blocker. This implementation is local,
uncommitted and undeployed. Production configuration and actual browser behavior
remain unverified and unchanged. Frontend integration was explicitly deferred by
the user, not left as a pending permission request. Current clients stay capped
until a later authorized client integration sends `rolling-v1`.

For a separately authorized rollout: first rehearse backup/restore and both additive
migrations on a fresh representative copy (never repair/use the damaged fixture as
proof); then use the normal reviewed migration/generate/build/deployment pipeline.
Provision the independent AEAD key and exact HTTPS Origin through approved secret
configuration, preserving old keys while live bundles/challenges need them. Keep
client opt-in gated until foreground activity, long-deadline timers, step-up and
device controls are integrated and tested. Monitor renewal/replay/revocation and
credential-history growth. Retain managed-family revocation checks during rollback;
do not drop auth tables/columns or downgrade to a binary ignoring them while roots
remain live. Retention cleanup still requires its own reviewed operating procedure.
See [the complete backend contract](rolling-authentication-contracts.md).

## Fresh-thread handoff — writer stopped

This section is authoritative; the sections below preserve prior checkpoints.
Parent requested a fresh thread. This old thread has stopped editing after saving
this handoff. There is no source-writer lock or owned process left active. A new
thread may take sole-writer ownership without overlapping this worker.

### Terminal verification

- **Final full regression: 2,137 passed / 110 suites**, zero failures and zero
  skipped tests, 527.343 seconds. `artifacts/auth-full.json` has `success: true`;
  `artifacts/auth-full.log` records the terminal summary. Exec session **43040**
  completed with `AUTH_FULL_EXIT=0`, then its finally block stopped PostgreSQL.
- **Current article coverage: 404 passed / 19 suites**, zero failures, extracted
  from that same final JSON. It includes article review HTTP/decision/contracts,
  proposals, drafts, conflict voting, keep-both, resolution, promotion, canonical
  contracts, forest, materialization and comparison. This is current local synthetic
  regression evidence, not an assumption from an older article milestone and not
  production publication or frontend review-flow completion.
- Affected-suite confirmation before final full run: **276 / 11 passed**
  (`artifacts/auth-db-focused.json`). The final run additionally covers the expanded
  400-day foreground-activity simulation.
- Latest lint, strict typecheck, build, format and Prisma validation all passed.
  Exec **9262** is terminal. Logs: `artifacts/auth-final-lint.log`,
  `auth-final-typecheck.log`, `auth-final-build.log`, `auth-final-format.log`,
  `auth-final-schema-validation.log`.
- Bash/ShellCheck passed (`auth-final-deploy-check.log`); 38 mock deployment scenarios
  passed (`auth-final-deploy-test.log`); the actual current release checker verified
  53 bounded contracts (`auth-final-release.log`). It used the present committed
  catalog, not its missing-catalog fallback. No catalog/checker was changed.
- The initial 2-worker run's **2,090 passed / 46 failed** evidence is retained in
  `artifacts/auth-full-first.json` and `.log`. All six failing suites passed in the
  affected confirmation and final serial full run. Fixes addressed transaction fault
  seams, fresh-auth test claims and resource-before-device stream error ordering;
  serial execution avoids cross-suite global SQL fault-trigger interference.

### Exact current scope and files

All changes are local and uncommitted. Initial backend status was clean. No commits,
pushes, deployments, live security settings, live credentials, Postman or uploads.
Tracked modifications:

```text
.env.example
Docs/browser-session-local-implementation.md
Docs/frontend/authentication.md
prisma/schema.prisma
src/auth/auth.guards.ts
src/auth/auth.service.ts
src/auth/auth.types.ts
src/browser-sessions/browser-session.config.ts
src/browser-sessions/browser-session.controller.ts
src/browser-sessions/browser-session.service.ts
src/projects/initialization-event-readback.ts
src/sessions/sessions.controller.ts
src/sessions/sessions.service.ts
src/telegram/telegram.service.ts
test/admin-department.http.spec.ts
test/auth.guard.spec.ts
test/auth.service.spec.ts
test/authorization-read-availability.http.spec.ts
test/browser-session.http.spec.ts
test/login-availability.http.spec.ts
test/login-session-setup.http.spec.ts
```

Untracked deliverables (preserve them):

```text
Docs/rolling-auth-implementation-checkpoint-20261024.md
Docs/rolling-authentication-contracts.md
prisma/migrations/20261024110000_rolling_browser_sessions/migration.sql
prisma/migrations/20261024120000_browser_stepup_otp/migration.sql
src/auth/session-authority.ts
src/browser-sessions/browser-session.dto.ts
test/rolling-auth.http.spec.ts
```

The implementation provides 90-day inactivity/no calendar cap for opted-in trusted
browser sessions, short access JWTs, atomic internal credential rotation/replay
revocation, issued-token device/all-account revocation, foreground renewal,
password/passwordless session-bound OTP step-up, retained AEAD keys, and both direct
SSE paths' device checks. New sessions snapshot inactivity in encrypted bundles.
Direct legacy refresh stays fixed/nonrotating and keeps its response shape.

**Client requirement:** send `X-Browser-Session-Policy: rolling-v1` at browser login
only after implementing activity/deadline handling. Without it, new browser logins
remain capped at at most 30 minutes idle / eight hours absolute. User explicitly
declined frontend access/editing: do not inspect/edit that sibling or ask again.
No frontend change exists, and the user's current frontend therefore does not yet
receive long-lived rolling behavior. Production/effective runtime configuration is
unverified and unchanged; BFF remains disabled by default in the example.

### Process/fixture ownership

- **No running test/fixture processes remain.** Exec 43040/full and 9262/static are
  completed; the pending `functions.exec` wait cell 80 also completed. Do not try to
  resume them as live jobs or kill their old/reused PIDs.
- Final `pg_ctl status` for the fresh cluster reports `no server running`; final
  `Get-Process node,postgres` returned no process rows. No CIM query was repeated.
- Fresh owned synthetic cluster:
  `C:/Users/user/AppData/Local/Temp/proboxai-rolling-auth-pg-20261024`.
  URL is exactly `postgresql://profile_test@127.0.0.1:55439/profile_test`.
  Startup/shutdown are owned by `artifacts/auth-full-run.ps1` / `auth-db-run.ps1`
  and use PostgreSQL 18's installed `pg_ctl.exe`. Both scripts stop in finally.
- Retained historical cluster `.../proboxai-atomic-profile-pg-20261016/data` is
  damaged (missing catalog files), stopped, and must not be repaired/overwritten.
  Migration-preservation evidence is from a fresh baseline with synthetic legacy
  rows: 90 original tables for migration one, 91 for migration two. Original-column
  hashes matched. `artifacts/auth-migration.log`, `auth-migration-latest.log` and
  `auth-migration-preservation.json` retain evidence; later before-probes overwrite
  the JSON snapshot, so do not confuse it with a post-test equality assertion.
- Test runner used one recycled 128MB worker and existing 30s Jest case budget.
  Global fault-injection tests must run serially against this single database.
  Do not reuse the earlier 2-worker command.

### Exact next actions — no new implementation required yet

1. Read this handoff and current contract. Confirm no new actor changed the checkout.
   Do not restart the completed full/static runs merely to recover their status.
2. **Final live schema parity and audit are not run yet.** Start only the fresh
   synthetic cluster (after status confirms stopped), then run Prisma migrate diff
   from the exact fixed URL to `prisma/schema.prisma` with `--exit-code`. Save its
   output/exit. Run prepared `node artifacts/auth-final-audit.mjs` to persist
   `artifacts/auth-final-audit.json`: identity, leftover fixture counts, migration
   state and trigger names. It flags names not textually found in migrations for
   review; do not automatically drop any trigger or delete data. Stop in finally.
3. Inspect the audit/parity result. Recover only genuine remaining auth-scope issues
   if found; otherwise finish a concise sanitized backend handoff with these exact
   test/static results, final parity, migration limitations and client opt-in gate.
   Retention/rollback and key overlap are documented in the new contract; no purge
   scheduler or production setting has been activated.
4. Frontend integration is deliberately unperformed; do not treat the declined
   work as an unresolved access request or claim end-to-end rollout. Guide download
   failure was already disclosed and is not a blocker. No Library upload is authorized
   for this continuation.

The old writer stops here; no additional source/document edits follow this handoff.

## Current backend-only checkpoint

- The user explicitly declined frontend access/editing. Do not access or retry the
  sibling checkout, and do not ask again. No client changes were made.
- First full run completed: 2,090 passed / 46 failed, six failed suites. It used
  two workers and exposed shared SQL fault-trigger interference, stale mock
  transaction seams/timestamps, and changed stream error ordering. Its evidence is
  retained in `artifacts/auth-full-first.json` and `.log`.
- Fixes preserve existing resource-authority errors, inject faults inside the new
  login transaction, mint direct-client access only after known commit, and supply
  current authentication timestamps in authorized synthetic mocks. The serial
  affected-suite confirmation passed **276 tests / 11 suites**, no failures
  (`artifacts/auth-db-focused.json`). It stopped its fixture cleanly.
- Upgraded browser clients explicitly opt in with the login header
  `X-Browser-Session-Policy: rolling-v1`. Unupgraded clients retain the capped
  compatibility profile. New sessions snapshot inactivity in their encrypted
  bundles. The rolling test now exercises 400 successive simulated active days.
- Comprehensive contract is `Docs/rolling-authentication-contracts.md`; frontend
  contract and `.env.example` are updated. Key parsing errors are sanitized.
- Bash/ShellCheck, all 38 mocked deployment checks, schema validation and the
  current release checker passed. The checkout now has the committed release
  catalog: its real checker verified 53 bounded feature contracts, rather than
  using the older missing-catalog fallback. No catalog/checker changes were made.
- **Currently running:** final serial full regression is exec session **43040**,
  command `& ./artifacts/auth-full-run.ps1`. It uses one recycled 128MB worker on
  the fresh synthetic profile_test fixture, writes `artifacts/auth-full.json` and
  `.log`, and stops PostgreSQL in finally. Inspect this run before starting any
  replacement. Final lint/type/build/format/schema commands are exec **9262**;
  logs are `artifacts/auth-final-*.log`. Do not assume success before inspecting.
- Final schema parity and finished verification/handoff update remain after the
  existing commands complete. Older sections below are historical checkpoints.

## Latest safe-boundary update (supersedes verification below)

- The original six failures are fixed. Expanded isolated tests now pass:
  **82 tests / 5 suites**, no failures (`artifacts/auth-db-focused.json`).
- Added passwordless session-bound Telegram OTP step-up, refusing password-required
  accounts; additive migration `20261024120000_browser_stepup_otp` applied with
  old-column preservation across 91 tables. Added current device authority checks
  to both direct persisted SSE delivery paths; no WebSocket server was found.
- Coverage now includes commit acknowledgement loss, legacy refresh compatibility,
  permission removal, other-account device isolation, password-reset JWT revocation,
  passwordless OTP binding/replay/password-required rejection and direct SSE revoke.
- Configuration example updated. Full regression/build/schema/aggregate checks and
  final migration/retention/frontend documentation still pending.
- The expanded run's typecheck found a duplicate import and generic mock typing;
  both were corrected after the passing runtime tests. Final typecheck passed,
  output `artifacts/auth-typecheck-latest.log`; exec session 87156 completed.
- Fresh synthetic fixture stopped in finally; no HTTP/database suite remains running.
- **Frontend operation denied:** `git -C ../ProboxAI_Frontend status --short`
  returned `Permission denied` in this continuation. It was stopped and not retried.
  Frontend files are readable, but its current uncommitted Git state and editing
  access are unverified. No sibling client changes exist. Do not bypass this denial;
  relevant new access authorization/workspace attachment is needed before retry.
- Parent requested another immediate safe-boundary checkpoint; backend work is saved
  and remains uncommitted. The older milestone details below are historical.

Local work in progress, not ready for deployment. No production migration,
live credentials/settings, commits, pushes, Postman changes or uploads performed.
The parent requested this safe-boundary checkpoint before implementation finished.

## Saved implementation

- Additive Prisma migration `20261024110000_rolling_browser_sessions`: false-default
  managed/rolling flags, refresh credential history, reauthentication metadata and
  account-wide revocation timestamp. Existing rows retain their old deadlines.
- Browser config defaults to 90-day inactivity and no absolute deadline for new
  sessions; bounded overrides allow shorter/absolute profiles. Retained AEAD keys
  support overlap; subsequent authenticated proxy use reencrypts with the active key.
- New browser sessions own stable refresh-family roots. Internal credentials rotate
  atomically with the encrypted bundle under database locks. Replayed consumed
  credentials commit root revocation before returning a rejection.
- Newly issued access JWTs carry a stable device root and authentication time;
  guards enforce root revocation, current account/workspace and account revocation.
  Legacy bearer refresh remains nonrotating; it rejects browser-managed roots.
- Activity, password reauthentication, bounded device listing, owned-device revoke
  and revoke-all controller/service paths are saved. Activity renews the cookie;
  GET/bootstrap/SSE do not extend inactivity. Password failures are rate limited.
- Sensitive permission mutations require authentication within ten minutes.
  Existing OTP registration/reset continues to require the existing password flow;
  no OTP login/step-up bypass was introduced.
- New rolling-auth HTTP tests and updated legacy auth/browser tests are saved.

## Verification actually completed

- Prisma client generation passed; typecheck passed after the implementation.
- Repository lint passed.
- Pure focused run: 12 passed, 8 database tests skipped, three suites passed
  (`artifacts/auth-unit.json`).
- Fresh synthetic database migration applied successfully. Identity checked as
  profile_test/profile_test on 127.0.0.1:55439. Old-column fingerprints across all
  90 baseline tables matched before/after, including four seeded legacy rows
  (`artifacts/auth-migration-preservation.json`, `artifacts/auth-migration.log`).
- Current focused database/HTTP run: **70 passed, 6 failed**, three suites passed,
  two failed (`artifacts/auth-db-focused.json` and `.log`). This is not a pass.
- Both owned/fixed fixture instances report stopped; no Node/PostgreSQL processes
  were found by the final process check. The owned command stopped its server in
  a finally block. No test is intentionally left running.

## Current failures and immediate next work

Five failures involve the new empty-body DTO rejecting `{}` before reaching the
activity/revoke handlers. Its custom validator counts the emitted `_empty` field:
allow that undefined internal field while rejecting all supplied values and other
keys, or use an equally strict empty-object pipe. The sixth failure is the existing
browser refresh/logout concurrency test; inspect its recorded failure and update
the fault seam from legacy refresh to managed session access minting as appropriate.
Do not relax authority or concurrency guarantees to make tests pass.

Then rerun focused tests, complete logout/reset/account-disable/membership and
step-up boundary coverage, inspect race/uncertain-outcome semantics, and run full
regression plus type/build/schema/format and aggregate checks. Document current
API contracts, migration/rollback and retention/key-rotation procedures, and update
`.env.example`. None of full regression/build/release/schema aggregate verification
has completed for this change. No release-readiness claim is made.

## Environment and client limitations

The retained old fixture has missing PostgreSQL catalog files (`global/6100`,
`base/16384/2224`). Its preservation probe failed before migration. It was not
repaired, overwritten or migrated. A fresh synthetic cluster was initialized at
`$TEMP/proboxai-rolling-auth-pg-20261024`, on the same fixed allowlisted endpoint,
with the committed baseline schema and synthetic legacy seed before applying the
new migration. It remains stopped and recoverable. Existing retained-fixture data
preservation is unverified; the passing preservation evidence is for the seeded
fresh baseline only.

Default sandbox Jest cache writes failed outside writable roots; subsequent tests
use `artifacts/auth-jest-cache`. Sandboxed localhost networking returned EACCES;
the authorized isolated run succeeded through the normal approval-reviewed tool.
The earlier denied CIM runtime query was not repeated.

The Library guide could not be materialized: the Windows alias Python launcher
was unavailable; the installed Python helper then returned download failed. No
readable guide bytes were available, and implementation used the source assessment
and explicit requirements. Temporary signed-transfer metadata was removed.

The frontend repository DOES exist at the sibling `ProboxAI_Frontend`. It was
inspected read-only and was not edited (outside the current writable repository).
Its adapter requires two timestamp strings and schedules expiry from them. Current
backend compatibility fields retain that shape; new `expiryPolicy`, `hardExpiresAt`
and `authenticatedAt` fields distinguish rolling policy. The actual client still
needs foreground activity integration, deadline refresh, step-up and device UI.
Do not claim end-to-end completion. Backend frontend-contract documentation is also
still pending. Browser-managed rotation is not exposed as a rotating direct-client
refresh API; a separately versioned direct-client migration remains future work.
