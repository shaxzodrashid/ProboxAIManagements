# Stable backend 0.3.4 preparation and rollout

Prepared from remote main at `98f5ef24c228657f5c983801e40d91c468c9125b`
(v0.3.3), verified on 25 October 2026. This candidate adds rolling browser
authentication, managed credential rotation, device revocation and recent-auth
verification. Package version, changelog, catalog and generated availability
identify 0.3.4. This document is preparation evidence, not publication or deployment
evidence. Existing tags remain immutable.

## Compatibility and client gate

New browser logins opt in only with `X-Browser-Session-Policy: rolling-v1`.
Without it, the compatibility profile remains capped at at most 30 minutes idle
and eight hours absolute. Existing browser sessions retain their stored deadlines.
Direct-client login/refresh response shapes and fixed nonrotating refresh remain.
New JWTs carry device authority; old unbound JWTs age out within their original
30-minute lifetime, while account-wide revocation also checks authentication age.

Role/permission and user-management writes now require authentication within ten
minutes. Clients must handle `RECENT_AUTH_REQUIRED` by confirming authentication
and asking the user to retry. Passwordless confirmation uses the current account's
verified Telegram link. Actual Telegram delivery and frontend behavior require
separate live acceptance. The sibling frontend has not been changed.

Enable rolling client policy only after foreground activity, long-deadline timers,
step-up and device controls are integrated. Backend deployment alone does not
complete that integration. See the [backend contract](rolling-authentication-contracts.md)
and [frontend contract](frontend/authentication.md).

## Database upgrade from 0.3.3

Exactly two migrations are added:

1. `20261024110000_rolling_browser_sessions`: account revocation time, managed
   refresh-root flag, browser rolling/authentication/reauthentication fields, and
   the `RefreshCredential` table with unique token hashes and a root foreign key.
2. `20261024120000_browser_stepup_otp`: session-bound step-up hash, deadline,
   attempts, rate-limit window and send count.

Both are additive. Existing managed/rolling flags default false; counters default
zero and new timestamps/hashes are null. Existing credentials, deadlines and
business records are not backfilled or deleted. Neither SQL file wraps its
statements in an explicit transaction: after any migration failure inspect the
ledger and actual schema before recovery; do not blindly retry or mark it applied.

The candidate requires the new schema. Before activation, confirm the real server
baseline and exact pending migrations, take and verify a private PostgreSQL backup,
quiesce all writers, and apply the candidate's migrations with the service's exact
ordered environment files. Never run migrate dev, reset or bootstrap seeds.
Independently verify all 53 migration checksums/completion states, the new columns,
defaults, unique/index/foreign-key definitions and existing trigger state.

## Local evidence

The completed 24 October synthetic full regression was independently read back:
2,137 tests in 110 suites passed, zero failures or skips, including 404 article
tests in 19 suites. All 24 implementation, schema, migration, configuration and test
file hashes in the final evidence inventory still match. During metadata preparation,
the full suite was not repeated; publication's normal precommit hook separately
reruns the repository gates. Frontend guidance was
updated after that inventory, and the backend contract received formatting only.
Local artifacts are evidence for this checkout, not immutable CI attestations.

Fresh 25 October release checks passed:

- `pnpm release:check`: 54 bounded contracts, with synchronized generated docs.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` and changed-document Prettier checks.
- Compiled `backendReleaseVersion` and package version both equal `0.3.4`.
- `pnpm deploy:check`: Bash syntax and ShellCheck.
- `pnpm deploy:test`: all 38 sandbox scenarios passed, including migration gates,
  environment order, readiness/version failures and runtime restoration.
- `git diff --check`.

The saved final audit has all 53 migration checksums/completion states, zero missing
or unexplained migrations/triggers, and 18 enabled noninternal triggers. Its Prisma
schema diff reports no difference. These saved schema results were reviewed; the
fixture was confirmed stopped and was not started during release preparation.

The fresh seeded synthetic fixture accepted all 53 migrations. Final schema parity
and the ledger audit passed, and the four legacy seed identities retained their
expected defaults. Earlier original-column preservation checks were reported for
90 and 91 tables, but their reusable JSON was overwritten by a later before-probe;
those historical equality checks were not independently re-proven. The damaged
older fixture was not repaired or used. Rehearse backup restoration and both
migrations on a representative copy before production rollout. Local synthetic
evidence does not establish production-data preservation.

## Publication and operator sequence

1. Review and commit the verified candidate, then create an annotated `v0.3.4`
   tag on that exact commit. Run `pnpm release:check -- --published`.
2. Publish the approved commit to main with its tag, then independently read back
   remote main and the peeled tag. Local tag validation alone is insufficient.
3. On app2, inspect current service/release/source state and prepare the candidate
   through the [configured wrapper](deployment-app2.md). Pending migrations stop
   preparation before switching runtime; inspect that candidate and migration delta.
4. Perform the backed-up, quiesced migration and independent readback above, one
   inspected operator step at a time. The wrapper never applies migrations.
5. Once migration readiness is verified, run from app2's root shell:

   ```bash
   runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
   ```

6. Require `Deployment healthy: 0.3.4`; verify selected and actual process release,
   readiness dependencies and public OpenAPI version 0.3.4. Check compatibility
   login and, with an integrated client, activity renewal, step-up and revocation.

Keep persistent storage and ordered environment files in place. Browser sessions
remain configuration-controlled; no production credentials/settings are changed
by release preparation. Retain active and previous encryption keys while live
bundles or OTP challenges depend on them. Monitor credential-history growth;
automatic retention cleanup is not included.

## Rollback constraint

A runtime rollback does not undo schema or authentication state. An old binary
does not enforce managed-family/device revocation. Do not downgrade while managed
families remain live; use a reviewed compatible recovery build that retains these
checks. A capped policy for new sessions can stop new rolling issuance without
dropping additive schema. Existing device revocation or data cleanup requires a
separate deliberate operation. Preserve consumed hashes for live families.
