# Stable backend 0.3.6 preparation and rollout

Prepared on 16 November 2026 from independently verified remote main
`83af917ac3d1176c504a549b9c17fe6e2e9618fc` (0.3.5). The candidate contains
newest-first session history and multiple browser frontend origins. Package
version, changelog, release catalog and generated feature availability identify
0.3.6. Remote v0.3.6 did not exist at preparation. Preparation does not establish
publication or deployment.

## API and frontend compatibility

Existing `/api/v1` routes remain compatible. `GET /sessions/:id/events` retains
ascending `after` pagination when `direction` is omitted. Clients opt into
`direction=backward` for descending history, then use `nextCursor` as `before`
and the first response's `highWaterSequence` as `untilSequence` on older pages.
Stop when `hasMore` is false. Display events in the desired UI order without
changing the server cursor. Mixing `after` with backward mode, using `before`
without backward mode, or requesting backward SSE returns 400. Missing persisted
sequences return 409 rather than a misleading successful page. Every page retains
the current workspace, assigned-manager and `sessions.read` checks.

See [assistant text and history contract](session-assistant-text-contracts.md).
Frontend integration and live acceptance remain separate from backend tests.

## Browser configuration

Existing `BROWSER_SESSION_ORIGIN` configurations remain supported. A nonempty
`BROWSER_SESSION_ORIGINS` overrides that setting and contains a comma-separated
list of exact origins. Paths, trailing slashes, credentials, wildcards and empty
entries are rejected. Production origins require HTTPS, including localhost;
HTTP loopback is permitted only in nonproduction configurations. Mixed schemes
are rejected to preserve the shared Secure cookie policy.

Every frontend must proxy `/api/v1/browser` to this backend while preserving
Origin and Fetch Metadata. This does not enable credentialed cross-origin CORS.
Cookies remain host-only; each frontend origin requires its own login. Existing
CSRF, JSON, bearer-header and cross-site request defenses remain in place.
See [browser origin configuration](browser-session-origins.md). Add real origins
and proxy rewrites only as an explicit operator configuration change.

## Database and runtime upgrade

No migrations, Prisma schema changes or dependency changes are added relative to
v0.3.5. The existing 54 migrations remain required; verify the real production
ledger before runtime activation. Do not use migrate dev/reset or seeds against
production. Preserve the existing ordered service environment files and browser
encryption keys. Browser sessions remain explicitly opt-in.

## Local release checks

The release preparation uses an isolated loopback `profile_test` database on
port 55439, with a fresh cluster, source migration checksum verification and
Prisma schema parity. It runs the complete Jest regression suite, including the
database-backed session HTTP tests and native Windows directory tests, without
weakening assertions or adding skips. The normal commit hook additionally checks
staged formatting, release metadata, deployment scripts, types and tests.

Release checks include `pnpm release:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm deploy:check`, `pnpm deploy:test` and `git diff --check`.
Compiled release metadata must equal 0.3.6. Local validation logs and database
audit evidence use the ignored `artifacts/release-0.3.6-*` prefix. They are local
evidence, not immutable CI attestations. Consult the preparation result for the
actual pass/fail outcome; this runbook is not itself proof of passing checks.

## Publication and operator sequence

1. Recheck remote main and that v0.3.6 is unused. Review the complete candidate,
   complete release checks and commit it on `main`.
2. Create an annotated v0.3.6 tag at that exact commit and run
   `pnpm release:check -- --published` for local tag provenance. Never overwrite
   existing tags. Publish the verified commit to main with its tag when
   authorized, then independently read back both remote references.
3. Use the [app2 wrapper](deployment-app2.md) to prepare the published candidate.
   With service activation authorized, run:

   ```bash
   runuser -u proboxai -- /srv/proboxai/operator/proboxai-deploy restart
   ```

4. Require `Deployment healthy: 0.3.6`. Independently verify the selected and
   actual process release, dependency readiness and public OpenAPI version.
5. Verify ascending history, backward multi-page history with a fixed boundary,
   permission denials and SSE replay. If additional origins are configured,
   verify login, CSRF, refresh and cookie behavior through each frontend proxy,
   plus rejection of foreign origins.

## Rollback

Runtime rollback to 0.3.5 requires no schema reversal. Coordinate a frontend
fallback to ascending history. Restore the singular origin configuration before
using a runtime that does not understand the plural setting; otherwise only its
legacy configured origin works. Preserve browser keys and rolling-device
authentication state. Runtime rollback does not undo shared business data or
authentication state.
