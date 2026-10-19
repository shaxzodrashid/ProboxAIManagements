# Proposed same-origin browser session / BFF contract

**Review draft only — not approved or implemented.** The parent has asked the user
about the BFF direction and is awaiting an answer. Every new route, duration,
storage rule and control below is proposed. Existing frontend ADR-003 remains in
force; production still uses unavailableAuthApi. No frontend/runtime/security
configuration, credential, schema or deployment changes accompany this document.

## Verified starting point

Frontend: `D:\Shakhzod\Javascript\ProboxAI_Frontend`, authentication feature,
`src/app/routes.ts`, `src/features/authentication/api/auth-api.ts`,
`model/auth-contract.ts`, `ui/Authentication.tsx`, and ADR-003. Sign-in UI exists;
live sign-in/session transport and authenticated destination are gated. Public env
currently allows only environment/release metadata; no API-origin env is approved.

Backend: `src/auth/auth.service.ts` issues a30-minute access JWT and30-day refresh
token. Only the refresh hash is persisted. Refresh returns a new access token and
does not rotate refresh. Password reset revokes existing refresh records. Current
JWT guards reread OPEN identity/current grants, but do not look up the refresh row
for each bearer request. No browser cookie session/logout/revocation API exists.
Cookie parsing is not cookie authentication. These legacy contracts stay intact.

## Proposed deployment and trust boundary

Recommend a service-owned BrowserSessions module beside the existing Nest backend,
using the existing primary PostgreSQL and existing server secret-management layer.
This avoids assuming Redis, a second identity system or a new frontend framework.
Infrastructure must confirm that placement before implementation.

The SPA and BFF share one exact public HTTPS origin. Proposed BFF prefix:
`/api/v1/browser`. The browser uses only that prefix for authenticated APIs.
Protected BFF requests resolve the opaque cookie server-side, then use a fixed
internal backend origin and server-owned bearer token to call existing guarded
`/api/v1/...` routes. Existing bearer endpoints never begin accepting cookies.
The BFF has no authority to bypass workspace, manager, membership or permission
checks. Its resource route is an explicit method/path allowlist, not an arbitrary
URL proxy; exclude its own prefix and raw auth token endpoints to prevent recursion
or token exposure. Upstream origin cannot come from a browser body/header/query.

Initial allowlist: self/authorization, eligible project/task discovery, catalog/
execution-context/preflight, session create/read/history/stream, follow-up/receipt
and interrupt. Add keyed project/task creation only when that UI branch is wired.
Existing profile/admin/deletion endpoints are not implicitly exposed through a
generic browser proxy. No cross-origin credentialed CORS is needed or proposed.

## Proposed cookie, storage and expiry defaults

| Item                 | Recommended draft value / behavior                                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser cookie       | `__Host-probox_sid=<opaque>; Secure; HttpOnly; SameSite=Lax; Path=/`; no Domain attribute                                                                                                                                                                                                                |
| Identifier           | 32 CSPRNG bytes encoded base64url; contains no user, workspace, role or token claims. Store only its SHA256 lookup digest server-side. Reject malformed/duplicate ambiguous cookies.                                                                                                                     |
| Token storage        | Access/refresh values recoverable only server-side, AEAD-encrypted at rest with key ID and record-bound authenticated metadata; separate managed encryption key, never JWT_SECRET reuse. No bearer tokens in JSON, HTML, URLs, browser storage, telemetry or logs. Password remains request-memory only. |
| Browser record       | Digest, kind anonymous/authenticated, bound user/workspace, associated backend refresh-token row ID, encrypted token bundle/expiry, encrypted recoverable CSRF secret plus validation hash, version, created/last-active/absolute expiry, revokedAt. No cached grant snapshot is authority.              |
| Anonymous bootstrap  | 10-minute maximum; no account rights. Rotate identifier and CSRF secret after successful authentication; never promote/reuse the anonymous identifier.                                                                                                                                                   |
| Authenticated expiry | Proposed30-minute idle and8-hour absolute maximum, clipped to refresh-token expiry. No remember-me option in the first slice. Server enforces both; cookie Max-Age never exceeds remaining absolute lifetime.                                                                                            |
| Activity             | Foreground API activity may advance idle expiry; bootstrap, SSE heartbeats/reconnect and background status polling must not keep the browser session alive indefinitely. Exact activity classification needs UX confirmation; absolute expiry never slides.                                              |
| Rotation             | New identifier/CSRF on successful sign-in, account switch and explicit reauthentication; old identifier invalidated. Rotation and writes use version/compare-and-swap to prevent stale refresh from resurrecting a revoked record.                                                                       |
| Failure              | Store/encryption/upstream dependency outage503, not anonymous success. No memory-only fallback or plaintext token persistence. Active streams fail closed.                                                                                                                                               |

Repeated bootstrap returns the same generation-bound CSRF token by decrypting its
server-side secret; a hash alone cannot support that readback. Bootstrap must not
rotate the CSRF token on each tab refresh and invalidate other tabs. Encrypt the
anonymous CSRF secret with the same approved record-bound AEAD mechanism; delete
it when the record expires. Rotate only with the documented identity/session
generation change. CSRF encryption does not make a failed store check anonymous.

Cookie prefix constraints require Secure, Path=/ and no Domain; HttpOnly is also
explicitly set here. See [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
The duration numbers are proposed product defaults, not a standard requirement.
The record/expiry/rotation approach follows the principles in
[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
Encrypted bundles are deleted on revocation/expiry; retention of minimal security
audit metadata needs a separate approved duration. Proposed seven days, no tokens
or credential-derived payload. Encryption-key ownership/rotation and backup access
must be confirmed; no key is created or issued in this task.

## Proposed public BFF endpoints

All routes below are new proposals, not registered backend capabilities.

| Method/path                                       | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/browser/session`                     | No-store bootstrap. With no valid session:200 `{authenticated:false,csrfToken,csrfExpiresAt}` and bounded anonymous cookie. With valid session:200 `{authenticated:true,user:{id,workspaceId,displayName},permissions,csrfToken,idleExpiresAt,absoluteExpiresAt}` after fresh identity/grant checks. No tokens. Dependency failure503; never convert a failed check into anonymous state.                                                                                                                                                       |
| `POST /api/v1/browser/login`                      | JSON username/password plus CSRF header and exact Origin. Calls existing auth logic, validates response, binds its refresh-token record and stores encrypted credentials before issuing a new opaque cookie.200 with authenticated bootstrap shape. Invalid credentials401; invalid input400; CSRF403; dependency/unknown outcome503. No password retention or automatic login replay. Lost acknowledgment is reconciled by bootstrap if the new cookie reached the browser; a lost rotated cookie cannot be recovered through an old-ID alias. |
| `POST /api/v1/browser/logout`                     | No account/session selector. Invalidate only this browser record and its associated refresh row, close its streams and clear cookie using identical name/path/security attributes.204 after confirmed invalidation; idempotent when already absent. Dependency/unknown commit outcome503; do not claim confirmed server logout before reconciliation. Origin remains checked even for an absent session; valid existing records require CSRF.                                                                                                   |
| Explicit `/api/v1/browser/api/<allowlisted path>` | Cookie + fresh browser/refresh-row/user validity, server-owned bearer injection, original backend guards. Preserve allowed body, quoted If-Match and operation requestId unchanged.401 missing/expired browser session;403 CSRF/permission denial;404 unavailable resource;409/428 upstream conflicts/preconditions;503 dependency failure. Error envelopes remain bounded and machine-readable.                                                                                                                                                |

Bootstrap may allocate an anonymous CSRF context, never a privileged session or
domain mutation. Rate limits/anonymous-record quotas require an infrastructure
budget. A known valid server session must not be destroyed by an upstream503.
Successful rotation invalidates old identifiers; if cookie delivery is lost, an
explicit new sign-in is allowed but no AI/domain mutation is retried in the process.

## CSRF and request handling

Recommend a synchronizer token returned by same-origin bootstrap and kept in
feature/app memory. Require it in `X-CSRF-Token` for every unsafe BFF method,
including login/logout; compare its hash in constant time against the current
anonymous/authenticated record. Rotate it with authentication changes. No token in
query strings, access logs or a public readable session cookie.

For unsafe requests require exact configured Origin (scheme/host/port); reject
missing/null/foreign origins rather than derive authority from Host or forwarded
headers. Reject cross-site Fetch Metadata when present; same-site siblings still
must pass exact Origin. Require JSON for login and normal JSON writes; approved
multipart uploads still require the custom CSRF header and valid boundary/type.
Reject simple form/text login fallbacks. Safe reads/streams expose no CORS response
to foreign origins and reject an explicit foreign Origin/cross-site fetch context.
No business operation becomes a GET. HttpOnly does not prevent same-origin XSS
from acting, so existing frontend content handling remains necessary.

SameSite is defense in depth, not the CSRF mechanism. This distinction and the
origin/token checks are grounded in
[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Refresh, logout, revocation and account change

Before proxying, check browser expiry/revocation, bound workspace, current OPEN user
and the associated backend refresh row's purpose/owner/expiry/revocation. This new
BFF-only fence makes password-reset refresh revocation effective on its next check,
without changing existing bearer JWT guards or claiming global access-token revoke.

Refresh only while that browser session remains valid. Proposed60-second expiry
headroom; use one refresh flight per browser record across replicas, with database
version/locking. Refresh does not rotate the existing backend refresh token, extend
the browser's absolute lifetime or revive a revoked session. Infrastructure failure
returns503 without clearing valid state; definitive credential rejection invalidates
the browser session. Never refresh on a permission403.

Do not automatically replay writes after upstream401, timeout or lost response.
Refresh/retry a safe read at most once; a mutation retains its existing request
identity and uses its endpoint-specific receipt where available. Initial session
creation remains unknown-outcome until the separately proposed receipt contract
is implemented. The BFF is not an idempotency layer for arbitrary writes.

Recommended logout scope: this browser session and its one associated refresh
record only. No account-wide logout, other-device revocation, JWT denylist or admin
override is included. A service-owned targeted refresh revoke is a new proposed
internal operation, constrained to that bound record; no existing public revoke
endpoint is assumed. Co-located storage should make browser invalidation and
targeted refresh revocation one transaction. Existing access JWTs may remain valid
for up to their existing30-minute expiry outside the BFF; this is not a promise of
universal immediate logout. Already accepted domain actions/runs are not rolled
back or automatically interrupted by logout.

Account switch is explicit logout then login, never a body-supplied user/workspace.
All same-origin tabs share this cookie/session. A nonsecret BroadcastChannel hint
may prompt bootstrap, but never carries credentials or authority. Tabs discard
old-account drafts/caches/sequences and ignore late responses using a session
generation. An already accepted old-account mutation remains owned by that actor.

## Origin, reverse proxy and SSE

Infrastructure must provide one exact public origin, fixed internal upstream and
trusted proxy hop/CIDR policy. Strip untrusted Forwarded/X-Forwarded headers at the
edge; set canonical values there. Do not enable broad trust-proxy to infer HTTPS
from arbitrary clients. Do not follow upstream redirects. Browser Authorization,
Cookie and identity headers are never forwarded as upstream credentials; inject
only the BFF-owned bearer. Strip upstream Set-Cookie and hop-by-hop headers. Reject
browser-supplied Authorization on the cookie-only BFF interface to avoid ambiguity.
Pass only allowlisted request headers, including content type, quoted If-Match and
validated Last-Event-ID; do not log prompts/bodies/credentials by proxy default.

All session/credential/protected BFF responses use Cache-Control:no-store; disable
shared/CDN/service-worker caches. SSE uses text/event-stream, no-store/no-transform
and disabled buffering/compression on that route. Stream existing event data/IDs
without inventing completion. Proposed15-second comment heartbeat and75-second
proxy idle timeout; neither heartbeat advances the browser idle lifetime. Values
and connection limits need infrastructure confirmation. SSE framing/reconnection
semantics follow the [HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html).

At stream open validate browser session and existing resource authorization.
Proposed browser/refresh-row revocation check at most every5 seconds while open;
backend's existing grant/resource reauthorization remains in force. Close at the
earliest browser deadline, revocation, upstream access expiry or authorization loss.
Logout closes local streams; other replicas observe the durable invalidation within
the approved polling bound. A store outage closes streams. Before headers return503;
after streaming starts, close transport and have the client bootstrap/reconcile.
EOF is not completion. Never refresh credentials by restarting or replaying a run.

Recommend cookie-authenticated streaming fetch for controllable bootstrap/error
handling; no token in the SSE URL. Reconnect from the last applied sequence with
existing after/Last-Event-ID rules. No connection survives account-generation change.

## Local controlled setup and migration from unavailableAuthApi

1. Approve this contract and values first; update frontend ADR-003 through its
   owner. Auth UI remains gated until then.
2. Implement behind an explicit server feature gate, default disabled. Use the
   isolated database, synthetic OPEN accounts and stub upstream auth/runner. No
   live account creation, Telegram OTP, external provider or deployment is required.
3. Run SPA+BFF at one loopback HTTPS origin with a trusted test certificate provided
   through the existing approved local setup. Do not silently drop Secure or weaken
   __Host attributes for HTTP development. Certificate/trust changes require owner
   confirmation; pure handler tests can run before browser TLS is arranged.
4. Implement bootstrap/CSRF/store/login/logout and strict proxy allowlist, with
   server-side revocation/version fencing and sanitized failure contracts.
5. Add a browser-session adapter/context at the existing frontend public boundary;
   reuse forms and error/concurrency logic. No VITE secret, browser bearer storage
   or new state library is implied. Wire sign-in first to bootstrap and a protected
   current-workspace destination. Activation/reset stay explicitly gated until
   their temporary-grant BFF contract is reviewed; do not fall back to live raw
   bearer-token adapters. Existing isolated auth simulations remain separate.
6. Add eligible project/task discovery, then catalog/preflight/start/REST/SSE,
   follow-up and interruption. Preserve endpoint-specific receipt behavior.
7. Run the acceptance gates below. Only after a separate release authorization
   configure the actual public origin/proxy/store keys and verify that target.

Rollback closes/invalidate BFF browser records and returns frontend composition to
unavailableAuthApi; no browser-storage token fallback. Retain additive schema until
an approved cleanup. Rollback does not stop accepted AI runs or revoke all legacy
bearer tokens. Old backend/SPA versions must not accidentally expose the new route
through an unrestricted proxy. Exact deployment/rollback ordering needs release review.

## Owner/infrastructure decisions and acceptance gates

Confirm: BFF placement/namespace, exact origin/trusted edge, encryption-key owner
and recovery/rotation,30-minute idle/8-hour absolute/10-minute anonymous lifetimes,
activity definition, no-remember-me scope, browser-only logout/revocation boundary,
seven-day minimal audit retention, five-second stream revocation bound and
heartbeat/proxy limits, local HTTPS setup, supported browsers, post-login route and
activation/recovery rollout scope. These are recommendations awaiting approval.

Required tests: no access/refresh/password in browser artifacts/storage/logs;
__Host cookie attributes and fixation resistance; unknown/expired cookies; exact
Origin plus CSRF on login/logout/all unsafe proxy writes; sibling-site/null Origin
and multipart cases; concurrent refresh versus logout/account switch across replicas;
503 versus401/403; refresh nonrotation and absolute deadline; password-reset/OPEN/
workspace/grant revocation; no write replay; SSE expiry/logout/store outage, ID replay
and event deduplication; lost login/logout acknowledgments; stale-tab results; protected
proxy SSRF/redirect/header/cache rejection; genuine controlled login-to-result browser
journey. A simulated green test is not live deployment/provider evidence.

Separate proposal: [initial creation receipts](initial-session-create-receipt-proposal.md).
Parent readiness sequence: [login to session plan](ui-session-readiness-plan.md).
