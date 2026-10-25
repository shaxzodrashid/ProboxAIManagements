# Local browser login implementation — 19 October 2026

**24 October update:** the duration, credential-revocation and single-key sections
below describe the historical implementation. The current local contract is
[rolling authentication](rolling-authentication-contracts.md), including explicit
client opt-in, retained keys, session-bound step-up and issued-token revocation.
Frontend changes are deferred by the user; no rollout or live settings were changed.

The owner approved the protected-cookie/server-held-token design at06:35 UTC.
This implementation is local and disabled by default. No deployment, production
migration, persistent key provisioning or live security change was performed.
Existing bearer endpoints keep their authentication and revocation behavior.

## HTTP contract

The SPA uses same-origin `/api/v1/browser`. GET `/session` returns a discriminated
anonymous/authenticated response with an in-memory CSRF token; no access/refresh
tokens. POST `/login` takes the existing LoginDto, rotates opaque ID and CSRF, and
returns current identity/permissions and deadlines. POST `/logout` accepts only
an empty JSON object and revokes this browser plus its bound refresh record.
It does not interrupt coding runs or revoke other browser/bearer clients. Already
authorized in-flight requests may complete. A lost acknowledgement is not replayed.

Unsafe requests require JSON, exact configured Origin and X-CSRF-Token. Missing,
null and foreign Origin, cross-site Fetch Metadata and browser-supplied bearer
headers fail closed. Current persisted OPEN status, workspace and refresh validity
are checked before each protected proxy; original backend guards still enforce
current grants and resource scope. Store failures produce503, not anonymous success.

## Server configuration

| Variable                     | Default / validation                                           |
| ---------------------------- | -------------------------------------------------------------- |
| BROWSER_SESSIONS_ENABLED     | false; opt in with true                                        |
| BROWSER_SESSION_ORIGIN       | One exact origin, no path/trailing slash/credentials           |
| BROWSER_SESSION_KEY          | Independent32-byte base64url AEAD key; never JWT_SECRET        |
| BROWSER_SESSION_KEY_ID       | v1; alphanumeric, underscore or hyphen, at most32 characters   |
| BROWSER_SESSION_ANONYMOUS_MS | 600000; configurable1000–1800000                               |
| BROWSER_SESSION_IDLE_MS      | 1800000; configurable1000–28800000                             |
| BROWSER_SESSION_ABSOLUTE_MS  | 28800000; configurable1000–86400000; clipped to refresh expiry |

Production requires HTTPS. The cookie is `__Host-probox_sid`, Secure, HttpOnly,
SameSite=Lax, Path=/, no Domain. Explicit nonproduction loopback HTTP uses a separate
`probox_dev_sid` HttpOnly/SameSite=Lax cookie. It never weakens the production prefix.
The existing Nest internal listener remains HTTP behind same-origin TLS termination.
No credentialed cross-origin CORS was added.

PostgreSQL stores SHA256 opaque-ID digests and AES-256-GCM token/CSRF bundles bound
by AAD to the record and key ID. The additive migration changes no existing account
or token rows. Anonymous records have no account rights; browser records cascade
when their bound refresh row is deleted. Passwords remain request-memory only.

A PostgreSQL row lock serializes refresh and logout across instances. Access refresh
starts within60seconds of expiry. Absolute expiry never slides. Only foreground POST
activity may extend idle expiry; bootstrap, GET polling and SSE do not. The first
configuration supports one active key. Rolling key rotation and expired anonymous
row pruning/retention require an operator policy before production. Expired/revoked
records cannot authorize requests even before pruning. No managed key was created.

## Proxy and streaming scope

The explicit method/path allowlist covers self/authorization, project/task list and
UUID detail, model catalog, project execution context, directory preflight, session
create/list/detail/events/stream, follow-up/receipt and interrupt. It excludes raw
authentication, recursive BFF calls, profile/admin mutations, file access and deletion.
Browser input cannot choose the upstream origin or port: the proxy calls its own
loopback listener. Existing DTO/resource/workspace checks execute again there.
Only bounded If-Match and Last-Event-ID headers pass through; browser cookies,
identity/hop headers and upstream Set-Cookie do not. Responses are no-store.

SSE forwards persisted event IDs/frames. It adds15-second comment heartbeats, closes
on75seconds without upstream data, rechecks browser/refresh validity every5seconds,
and closes at the initial access/idle/absolute deadline. Original streams still
recheck current grants. Heartbeats never extend idle. EOF is not completion;
reconnect with the last delivered sequence and reconcile with REST.

## Frontend slice

Sign-in now uses the BFF adapter. Activation/recovery remain unwired; their temporary
grant transport was not authorized by this decision. The new `/setup` route loads
current identity and real authorized projects/tasks/catalog, offers model-specific
efforts, performs read-only directory preflight and submits one deliberate session
start. It shows durable acceptance and an explicit persisted-status read. This is
a minimal real setup surface, not the complete session output UI. Initial session
create still has no receipt/idempotency contract; uncertain starts are not replayed.

Logout,401, generation changes and nonsecret BroadcastChannel hints clear protected
in-memory state and abort requests. Late decoded responses are discarded. Uncertain
logout clears local exposure and reports that server logout was not confirmed.

## Controlled local verification

Use only the retained synthetic database:
`postgresql://profile_test@127.0.0.1:55439/profile_test`.
Set PROFILE_TEST_DATABASE_URL to that exact value; `pnpm handoff:prepare` refuses
any other target and applies migrations only there. Start the registered frontend
with BROWSER_BFF_LOCAL_TARGET=http://127.0.0.1:3050 and `pnpm dev`.
Run `node scripts/verify-browser-session.mjs` in the backend. It owns its synthetic
3050 API, random memory-only secrets, fixture cleanup and controlled runner. It
requires the sibling frontend's installed Playwright and Chrome. No real runner,
provider, Telegram, storage service or AppModule starts. The redacted report is
`dist/browser-session-verification/browser-result.json`.

The browser journey verifies anonymous redirect, real sign-in/setup/preflight/start,
sequenced controlled SSE output, authoritative completion plus REST parity, HttpOnly
cookie/no browser bearer or persistent credentials, and cross-tab logout. The HTTP
suite additionally covers origin/CSRF, encryption binding, expiry, refresh failure,
concurrent refresh, current status/workspace isolation and storage503 behavior.
Local browser checks use HTTP with the explicit development cookie; deployed TLS,
production key operations and production routing remain unverified and disabled.

For manual use, run `pnpm handoff:serve --browser-origin=http://127.0.0.1:5173`
alongside that frontend development server. Only that exact frontend origin is
accepted by the CLI; omitting the flag preserves the backend-origin default.
Login refresh creation and encrypted browser persistence share one transaction;
browser refresh also reuses it, avoiding nested connection-pool waits.
Edge throttling, managed key/rotation, TLS and retention are
production prerequisites, not provisioning performed by this local implementation.
