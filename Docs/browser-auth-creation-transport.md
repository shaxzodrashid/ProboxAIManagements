# Complete browser authentication and project creation

Implemented locally on 22 October 2026. This supersedes the browser-route restrictions in the earlier frontend authentication/projects guide snapshots. Production deployment and enablement are separate operator actions.

The existing browser session service remains disabled by default. Enabling requires `BROWSER_SESSIONS_ENABLED=true`, an exact HTTPS `BROWSER_SESSION_ORIGIN`, an independent 32-byte base64url `BROWSER_SESSION_KEY` and the existing BrowserSession migration. The new verification grant is kept in the existing encrypted session bundle; this change needs no new migration. Never rotate the encryption key merely to restart the service.

## Authentication

The existing `/api/v1/browser/session`, `/login` and `/logout` endpoints remain unchanged. The new controller adds these routes below `/api/v1/browser/auth`:

- POST `registration/otp/send` and `password-reset/otp/send`: original RequestOtpDto and original Telegram verification, eligibility and rate-limit behavior.
- POST `registration/otp/verify` and `password-reset/otp/verify`: original VerifyOtpDto. The returned `temporaryToken` is a random 64-character session-bound handle, with `expiresInSeconds` bounded by the anonymous session deadline. The original purpose-bound bearer credential stays encrypted on the server.
- GET `usernames/availability?username=...`: original UsernameDto, requiring an active anonymous browser cookie.
- POST `registration` and `password-reset`: original completion DTOs, plus the matching handle in `X-Browser-Grant`.

Every write retains exact Origin, JSON and CSRF enforcement. Authorization headers from browsers remain rejected. Handles cannot be used in another browser, for the wrong purpose, after expiry or as bearer credentials to original auth endpoints. Registration does not implicitly sign in. Recovery continues to revoke the account's refresh tokens. The frontend never retries OTP or credential writes automatically; uncertain outcomes remain uncertain.

Sources: [controller](../src/browser-sessions/browser-auth.controller.ts), [session service](../src/browser-sessions/browser-session.service.ts), [HTTP tests](../test/browser-projects-auth.http.spec.ts).

## Project creation

The protected browser proxy now explicitly allows:

- POST `/api/v1/browser/api/projects/creation-submissions`.
- GET `/api/v1/browser/api/projects/creation-submissions/:requestId`.
- GET `/api/v1/browser/api/departments`.
- GET `/api/v1/browser/api/configuration-templates` and `/:id`.

Original controllers own validation, permission checks, workspace/resource scope, keyed outcome semantics and filesystem work. No legacy unkeyed POST projects, file operations, arbitrary proxy methods or other management endpoints were opened. A successful creation response remains 202 with an outcome record, not a ready-project guarantee. The frontend retains the UUID in its URL and reads the same outcome after response loss; it does not replay a possibly committed write.

## Frontend origin and production

The frontend Vite server accepts `BACKEND_API_TARGET=https://agent.probox.uz` from `.env.local` or its process environment. This is a server-only proxy target; browsers continue to call relative same-origin URLs. Production Secure cookies require a local HTTPS frontend with a trusted certificate, or a deployed HTTPS frontend with a same-origin reverse proxy. The allowed origin must match the frontend URL, not the upstream target. Origin and Secure cookie attributes must not be rewritten to bypass checks.

The public production bootstrap returned 404 during verification. This establishes unavailability, not whether its cause is feature configuration, deployment version or ingress routing. No production setting, account or project was changed.

## Verification

The targeted browser-session and new authentication/creation suites pass: 19 tests using real HTTP, guards, services, PostgreSQL and filesystem at the allowlisted isolated profile_test fixture. The frontend's real-browser journey passes activation, login, creation, persisted detail reload, lost-response reconciliation after reload, password recovery and login with the new password. Telegram was captured locally; live delivery and production enablement are not claimed. Backend typecheck/build and changed-file lint pass.

The test-only `scripts/frontend-projects-browser-fixture.mjs` runs the real fixture on port 3050 and accepts an explicit synthetic manifest output path ending in `backend-browser-fixture.json`. Use `PROFILE_TEST_DATABASE_URL=postgresql://profile_test@127.0.0.1:55439/profile_test`. No production environment/database fallback is used. In an interactive terminal, `stop` or Ctrl+C invokes its scoped cleanup. Abrupt process termination requires inspection and cleanup of that exact recorded fixture only.
