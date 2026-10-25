# Authentication APIs: frontend integration guide

Reviewed against the current local repository source on **24 October 2026**. All paths include the
`/api/v1` prefix. JSON property names are **camelCase**. Examples are illustrative,
not live credentials or captured production responses.

This is the canonical frontend authentication guide. Rolling authentication is
implemented locally, uncommitted and **undeployed**. This documentation update does
not establish production enablement or completed frontend integration. The sibling
frontend was not inspected or changed for this update. See the
[backend contract](../rolling-authentication-contracts.md) for implementation and
operating details and the [verification checkpoint](../rolling-auth-implementation-checkpoint-20261024.md#final-verification--fresh-task-completion)
for completed local verification; its final-verification section supersedes historical pending
statements farther down that file.

## Choose the correct transport

| Client / flow                              | Contract                                                                     | Credential handling                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Browser SPA sign-in and protected requests | `/api/v1/browser/*`                                                          | HttpOnly session cookie; CSRF token in memory                     |
| Browser registration and password recovery | `/api/v1/browser/auth/registration*`, `/api/v1/browser/auth/password-reset*` | Anonymous cookie/CSRF, then an in-memory `X-Browser-Grant` handle |
| Original API registration and recovery     | `/api/v1/auth/registration*`, `/api/v1/auth/password-reset*`                 | Public OTP requests, then a purpose-bound temporary Bearer token  |
| Existing direct API clients                | `/api/v1/auth/login`, `/api/v1/auth/refresh`                                 | JWT access token and opaque refresh token                         |

Use the browser session contract for SPA login. It keeps access and refresh tokens
on the server. Do not store passwords, OTPs, temporary tokens, access/refresh tokens,
CSRF tokens, or browser grant handles in localStorage, sessionStorage, IndexedDB,
URLs, analytics, or logs.
Keep sensitive form and session state in memory and clear it when the flow ends.

**Availability boundary:** browser sessions are implemented but disabled by default
(`BROWSER_SESSIONS_ENABLED=true` enables them). This guide does not establish that
they are enabled on any deployed environment. Their routes return `404` when
disabled. Production requires same-origin HTTPS routing and server configuration;
see [current session policy configuration](../rolling-authentication-contracts.md#policy-and-compatibility)
and [configuration validation](../../src/browser-sessions/browser-session.config.ts).
Do not fall back to storing bearer credentials in the SPA if browser login is unavailable.

Use the dedicated `/browser/auth/*` endpoints for browser activation/recovery.
They keep the actual temporary bearer credential encrypted on the server; the
returned `temporaryToken` is a session-bound handle, not an original API token.
The protected `/browser/api/*` proxy does **not** expose original auth routes.
There is no credentialed cross-origin CORS setup in `src/main.ts`. Do not assume
the browser cookie authenticates original `/api/v1/*` routes. See
[browser authentication transport](../browser-auth-creation-transport.md#authentication).

## Browser sign-in, restore, and logout

All browser URLs must use the frontend's origin. Use relative URLs and
`credentials: "same-origin"`; a local development proxy must preserve this contract.
Successful browser responses set `Cache-Control: no-store`; exclude these URLs and
their errors from service worker and application response caches too.

| Method and path               | Request                                                           | Success                                                                                  |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/v1/browser/session` | No body                                                           | `200`: anonymous or authenticated session                                                |
| `POST /api/v1/browser/login`  | `{ "username": "ada.lovelace", "password": "Correct-Horse-42!" }` | `200`: authenticated session; rotates cookie and CSRF token                              |
| `POST /api/v1/browser/logout` | Exactly `{}`                                                      | `204`: no response body; clears cookie and revokes this browser's session/refresh record |

Login accepts the optional `X-Browser-Session-Policy: rolling-v1` header described
below. It is a header, not a body field. Login still requires username and password;
the OTP step-up endpoints do not introduce OTP sign-in.

1. Bootstrap with `GET /browser/session` when the app starts or reloads. Keep the
   returned CSRF token in memory. An authenticated result restores the signed-in UI;
   an anonymous result shows sign-in. An unavailable response is an error state,
   not an anonymous result.
2. Submit login once with the anonymous CSRF token. Replace the entire session state
   with the successful response, including its **new** CSRF token.
3. Send protected reads through `/api/v1/browser/api/<original-resource-path>`.
   Send allowed mutations through that prefix with the current CSRF token.
4. On explicit logout, stop protected requests/streams and clear protected local
   state. Acknowledge server logout only after `204`. Do not parse `204` as JSON.

Anonymous response:

```json
{
  "authenticated": false,
  "csrfToken": "<anonymous-csrf-token>",
  "csrfExpiresAt": "2026-10-24T10:10:00.000Z"
}
```

Authenticated response from an opted-in login at the default configuration
(bootstrap, activity and successful step-up return the same shape):

```json
{
  "authenticated": true,
  "csrfToken": "<authenticated-csrf-token>",
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "workspaceId": "22222222-2222-4222-8222-222222222222",
    "displayName": "Ada Lovelace"
  },
  "permissions": [],
  "idleExpiresAt": "2027-01-22T10:00:00.000Z",
  "absoluteExpiresAt": "2027-01-22T10:00:00.000Z",
  "expiryPolicy": "rolling",
  "hardExpiresAt": null,
  "authenticatedAt": "2026-10-24T10:00:00.000Z",
  "reauthenticationMethod": "password"
}
```

Treat `authenticated` as the discriminator. Anonymous results have no user,
permissions, or authenticated deadlines. `permissions: []` is a valid signed-in
account, not a reason to show login. Permissions control visible actions, while
the backend still checks current grants, resource scope, and lifecycle on each request.

Browser write requirements:

- `Content-Type: application/json` and `X-CSRF-Token: <current csrfToken>`.
- The browser supplies `Origin`; it must exactly match the configured origin.
  Do not try to set this header in frontend JavaScript.
- Do not send `Authorization` on any `/browser/*` request. The service rejects it.
- Foreign/null/missing write origins, cross-site Fetch Metadata, and invalid CSRF
  are rejected with `403`. Logging into an already authenticated browser returns
  `409`; sign out before changing accounts.

The production cookie is `__Host-probox_sid` with Secure, HttpOnly, SameSite=Lax,
Path=/ and no Domain. Local nonproduction loopback HTTP uses `probox_dev_sid`.
JavaScript must neither read nor manufacture these cookies.

### Protected reads and session lifetime

Use `GET /api/v1/browser/api/users/me` for the full self profile and
`GET /api/v1/browser/api/authorization/me` for current roles and permissions.
Both support zero-permission OPEN accounts and accept no query selectors.
See [self profile](../self-profile-contract.md) and
[authorization reads](../authorization-read-contracts.md) for their response shapes.

The proxy has a method/path allowlist, not general API passthrough. For example,
`users/me/telegram-link`, original authentication routes and user/role administration
are not currently allowed. `GET`/`PUT users/me/model-preferences`, keyed project
creation and selected session mutations are allowed. Unsupported method/path pairs
return `404`. Check
[`browserProxyAllowed`](../../src/browser-sessions/browser-session.controller.ts)
before integrating another resource; its original DTO and permission checks still apply.

### Rolling policy and deadline interpretation

| Login / session                                   | Inactivity deadline                       | Fixed calendar deadline                                 |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Anonymous bootstrap                               | Ten minutes by default                    | Same anonymous expiry; no account rights                |
| Login without the policy header                   | At most 30 minutes                        | At most eight hours                                     |
| Login with `X-Browser-Session-Policy: rolling-v1` | Configured inactivity, default 90 days    | None by default; a configured nonzero cap still applies |
| Existing capped / pre-upgrade session             | Retains its cap; never silently converted | Original fixed deadline still applies                   |

An unknown policy header value returns `403`. Send `rolling-v1` only when the
frontend has implemented the activity, timer, step-up and device rules in this
guide. The response determines the effective policy; the header cannot override a
server cap. `BROWSER_SESSION_IDLE_MS` supports 1 second–365 days;
`BROWSER_SESSION_ABSOLUTE_MS=0` (the default) means no calendar cap for opted-in
logins. A nonzero configured absolute duration selects a capped profile. Shorter
limits apply to compatibility logins too. Anonymous lifetime is independently
configured, default ten minutes, maximum thirty minutes.

| Authenticated field      | Frontend meaning                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `idleExpiresAt`          | Current server-enforced inactivity deadline. Use this in both policies.                                                                       |
| `expiryPolicy`           | `rolling` or `absolute`; inspect the returned value.                                                                                          |
| `hardExpiresAt`          | `null` for rolling, otherwise the fixed deadline.                                                                                             |
| `absoluteExpiresAt`      | Compatibility timestamp string. For rolling it aliases `idleExpiresAt`; it is **not** a calendar cap. For absolute it equals `hardExpiresAt`. |
| `authenticatedAt`        | Time of login or successful step-up. Ordinary activity and access refresh do not advance it.                                                  |
| `reauthenticationMethod` | `password`, `telegram-otp` or `unavailable`, from the current account's stored methods.                                                       |

Authenticated deadlines are ISO timestamp strings. Calculate the UI deadline as
the earlier of `idleExpiresAt` and a nonnull `hardExpiresAt`. Re-arm on each new
session snapshot; do not retain the login's compatibility timestamp as a permanent
cap. For an older server response without policy fields, retain capped handling
using the earlier of `idleExpiresAt` and `absoluteExpiresAt`; do not infer rolling.
If that older server rejects the header, show an integration error instead of
silently retrying login under another policy.

New sessions snapshot their inactivity duration and cap policy at login. Configuration
changes do not convert existing capped sessions or revive expired sessions. Older
encrypted bundles without an inactivity snapshot use the configured duration on
renewal, still bounded by their original cap and refresh-root expiry. Clearing
cookies requires sign-in again. A cookie is a bearer credential, not hardware
device attestation.

### Foreground activity and idle renewal

`POST /api/v1/browser/activity` accepts exactly `{}` and returns `200` with fresh
session metadata. It requires the current cookie, exact Origin, JSON and CSRF.
Report only after authenticated bootstrap, while the page is visible and the user
is meaningfully reading/interacting. Use trusted pointer, keyboard or scroll
signals and throttle attempts to at most one per minute across the app. Coordinate
across tabs where possible; duplicate tabs are serialized safely on the backend.
Never renew from an interval, background tab, automatic polling, SSE heartbeat or
the fact that a tab remains open. Client signals cannot prove human presence.

Bootstrap, protected GETs and SSE do not advance inactivity or cookie expiry.
Automatic access refresh is also not activity. Allowed non-GET proxy requests
renew inactivity and cookie before the upstream resource result is known, so even
a rejected resource write can have renewed the session. Do not send artificial
resource writes to keep a session alive. Successful step-up renews activity too.

Install the response's fresh deadlines into the protected in-memory state only
for the current authentication generation. Identity/permissions remain subject to
server checks; renewal grants no new role, membership or resource access. After
a foreground resource write, safely bootstrap when fresh deadlines are needed.
After an uncertain activity response, bootstrap to reconcile before reporting
success; do not replay any resource mutation.

This event wiring example takes application-owned callbacks. Attach it only while
authenticated, remove it on logout/account change, and route failures through the
status handling below. The callback posts `{}` to `/browser/activity` and installs
the validated response under the current generation. It must not log secrets.

```ts
function watchForegroundActivity(
  report: () => Promise<void>,
  onFailure: (error: unknown) => void,
): () => void {
  let lastAttempt = -Infinity;
  let inFlight = false;
  const handle = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== "visible") return;
    const now = performance.now();
    if (inFlight || now - lastAttempt < 60_000) return;
    lastAttempt = now;
    inFlight = true;
    void report()
      .catch(onFailure)
      .finally(() => {
        inFlight = false;
      });
  };
  const events = ["pointerdown", "keydown", "scroll"];
  for (const name of events)
    window.addEventListener(name, handle, { capture: true, passive: true });
  return () => {
    for (const name of events) window.removeEventListener(name, handle, true);
  };
}
```

Meaningful reading can be represented by foreground navigation/scroll and explicit
user interaction; this example deliberately does not invent an idle renewal timer.
On wake, `pageshow` or visibility restoration, recheck deadlines and safely
bootstrap before exposing stale protected content. Those events alone are not
activity. Keep uncertain-logout recovery locked as described below.

A 90-day duration exceeds JavaScript's timer limit. The following timer only
rechecks a UI deadline; it never sends activity or authorizes a request. Replace
it whenever server metadata changes. Call `onDue` to lock stale content and start
safe reconciliation, not to claim that server revocation has committed.

```ts
function watchDeadline(deadlineMs: number, onDue: () => void): () => void {
  if (!Number.isFinite(deadlineMs)) throw new Error("Invalid session deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  function stop() {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("pageshow", check);
  }
  function check() {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      stop();
      onDue();
      return;
    }
    timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
  }
  document.addEventListener("visibilitychange", check);
  window.addEventListener("pageshow", check);
  check();
  return stop;
}
```

### Refresh rotation, concurrency and uncertain outcomes

The SPA never receives browser access/refresh credentials and never calls
`/auth/refresh` for a browser session. Access JWTs last thirty minutes. Protected
proxy requests and activity renew access when it is missing an expiry or within
sixty seconds of expiry. Bootstrap and device-list reads do not mint fresh access.

All new browser logins, including capped compatibility logins, use a stable managed
device root with internal rotating refresh credentials. Within one transaction,
the backend locks the browser/root, consumes the current credential, creates one
successor and stores it in the encrypted bundle. Concurrent tabs/requests read
that committed successor. The opaque cookie and CSRF token stay the same during
ordinary renewal; login rotates both. An old pre-managed browser bundle uses its
legacy refresh path and original bounds until sign-out/expiry.

A rollback consumes no credential. An unknown database commit acknowledgement can
return sanitized `503`; a later safe read with the **same cookie** discovers the
committed state. Do not manufacture a new cookie, switch to bearer refresh, retry
login automatically or replay the resource mutation. Bootstrap reconciles session
metadata; a safe protected read can exercise access renewal. A consumed, missing
or foreign managed credential detected during rotation commits root revocation
and then rejects with `401`; normal concurrent requests are serialized and do not
trigger replay revocation. The legacy `/auth/refresh` endpoint rejects managed
credentials. Direct-client refresh remains fixed/nonrotating as documented below.

### Sensitive actions: password and OTP-only step-up

Device revocation requires authentication within ten minutes. Original mutations
requiring `authorization.manage` or `users.manage` also require recent authentication
in addition to their existing permissions. Ordinary activity/refresh cannot satisfy
this check. These administration mutations are still outside the browser proxy
allowlist; step-up does not open new routes or grant permissions.

A stale sensitive request returns:

```json
{
  "statusCode": 403,
  "code": "RECENT_AUTH_REQUIRED",
  "message": "Recent authentication required"
}
```

Keep the signed-in UI and use `reauthenticationMethod` from a fresh session snapshot.
All step-up writes require the current cookie, Origin, JSON and CSRF:

| Method and path                                  | Exact JSON body                           | Success                                     |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------- |
| `POST /api/v1/browser/reauthenticate`            | `{ "password": "Correct-Horse-42!" }`     | `200`: fresh authenticated session metadata |
| `POST /api/v1/browser/reauthenticate/otp/send`   | `{ "locale": "EN" }` (`EN`, `RU` or `UZ`) | `200`: `{ "expiresInSeconds": 300 }`        |
| `POST /api/v1/browser/reauthenticate/otp/verify` | `{ "code": "123456" }`                    | `200`: fresh authenticated session metadata |

For `password`, show password confirmation for the current account. Do not send a
username, phone, grant, OTP or password confirmation field. The password is a
1–128 character string, unchanged by trimming/case conversion. Invalid passwords
return `401`; five failures block this device's password confirmation for ten
minutes, with subsequent blocked attempts returning `429`. This failure alone is
not evidence of session expiry; safely bootstrap if session validity is uncertain.

For `telegram-otp`, the account must already be authenticated, have no password,
and have a stored verified Telegram chat. Send only the locale; the server selects
the stored recipient. The OTP is a six-digit string, valid for five minutes,
single-use, with five failed attempts. Resend replaces that device's previous code;
at most three sends per device's ten-minute window are accepted (`429` thereafter).
Do not auto-resend after delivery/network failure or infer that a delivered code
committed successfully. Successful verification returns metadata, not a temporary
grant. Invalid/expired/consumed/wrong-device codes return `401`.

Both OTP step-up endpoints return `403` for password-bearing accounts. Registration
and reset OTPs/temporary grants cannot satisfy step-up. For `unavailable`, explain
that an approved verified method is needed before sensitive actions; there is no
new recovery or bypass endpoint. There is no OTP login or separate mandatory MFA
factor model in this implementation. Successful step-up does not switch accounts,
remove a hard cap, grant permissions or implement a future MFA policy.

Install the successful snapshot and clear password/code fields on completion or
cancellation. Then require a deliberate retry of the sensitive action. Do not
automatically replay a potentially accepted mutation after step-up or a timeout.

### Device management, expiry and revocation

`GET /api/v1/browser/devices` requires an authenticated browser and returns:

```json
{
  "items": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "createdAt": "2026-10-24T10:00:00.000Z",
      "inactivityExpiresAt": "2027-01-22T10:00:00.000Z",
      "current": true
    }
  ],
  "limit": 100
}
```

This is at most 100 owned active refresh roots, newest `createdAt` first (ID breaks
ties), without pagination/count metadata or device name, IP, user agent, token or
hash. It can include direct-client roots as well as browser roots. For a direct
root, `inactivityExpiresAt` represents its fixed refresh expiry. `current` identifies
the calling browser root. Do not display the list as a complete inventory when
the limit is reached; IDs identify roots and do not authorize access themselves.

| Method and path                           | Body / result                | Effect                                                                                                       |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/browser/devices/:id/revoke` | Exactly `{}`; `204`, no JSON | Revoke the owned UUID root. Other devices stay signed in. Malformed UUID: `400`; absent/foreign root: `404`. |
| `POST /api/v1/browser/devices/revoke-all` | Exactly `{}`; `204`, no JSON | Revoke all account refresh roots, set the account revocation timestamp and clear this browser cookie.        |
| `POST /api/v1/browser/logout`             | Exactly `{}`; `204`, no JSON | Revoke this browser/root and clear its cookie. Recent step-up is not required.                               |

Both device revocation writes require recent authentication and CSRF. Revoking the
`current` root ends this session too; unlike revoke-all, individual revoke does not
clear its cookie. Clear protected UI after success and bootstrap for anonymous
state when needed. Do not parse `204` as JSON. After revoking another device,
safely reread the device list. An already revoked owned root can still return
`204`; ownership is checked even though it no longer appears in the active list.

Expiry, logout and revocation reject subsequent authorization checks; activity,
refresh and bootstrap cannot resurrect an expired/revoked row. Bootstrap can issue
a separate anonymous cookie, which requires deliberate sign-in. The backend also
rechecks current OPEN status, workspace, roles and resource membership; permission
loss is not a reason to invent anonymous success or retain stale access rights.

Newly issued direct and browser access JWTs bind to a root, so per-device revocation
rejects already issued access as well as refresh. Pre-implementation direct JWTs
without that binding cannot be individually identified; they age out within their
original thirty minutes. Password reset and revoke-all also set an account-wide
revocation timestamp and reject earlier JWTs, including those older unbound JWTs.
An already accepted in-flight operation may complete. Logout does not interrupt
accepted coding runs or sign out independent devices.

SSE may close at its initial access/idle/hard deadline even if another request
renews the session. Browser streams also recheck browser validity every five
seconds. Both persisted direct SSE paths recheck current device/resource authority
before each batch (normally 500 ms polling plus database/network time). These are
polling bounds, not an instantaneous delivery/revocation guarantee. Dependency
failures close streams without renewing activity. Stream EOF is not completion:
recheck session and persisted resource state, then reconnect using the resource's
resume contract without replaying mutations.

### Request and state handling

These request examples return the HTTP response for the application's central
transport to classify. Validate successful JSON before installing it under the
current authentication generation; do not install an error envelope as session
state. Call bootstrap first, take the anonymous result's CSRF token, then submit
login once. Keep `rollingIntegrationReady` false until the checklist below passes.

```ts
async function bootstrapRequest(): Promise<Response> {
  return fetch("/api/v1/browser/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
}

async function loginRequest(
  anonymousCsrf: string,
  username: string,
  password: string,
  rollingIntegrationReady = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CSRF-Token": anonymousCsrf,
  };
  if (rollingIntegrationReady)
    headers["X-Browser-Session-Policy"] = "rolling-v1";
  return fetch("/api/v1/browser/login", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: JSON.stringify({ username, password }),
  });
}

async function activityRequest(currentCsrf: string): Promise<Response> {
  return fetch("/api/v1/browser/activity", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": currentCsrf,
    },
    body: JSON.stringify({}),
  });
}
```

These functions have no retry loop. Handle response loss and status explicitly;
wire abort signals/generation checks into the application transport. The foreground
watcher's `report` callback must check `activityRequest`'s status before installing
JSON, since `fetch` resolves on HTTP errors as well as successes.

Centralize session state in the transport layer. Tag requests with an authentication
generation; abort old requests and discard late results after logout, account change,
or a new session. Clear protected caches and streams on a confirmed session `401`.
A `401` from a valid login attempt means rejected credentials; public OTP and
temporary-token `401`s mean invalid/expired flow credentials. Step-up can also
return `401` for a wrong password/code while the session remains valid. Do not
apply protected-resource logout logic indiscriminately to those flows. Browser
flow endpoints also depend on their cookie; if validity is uncertain, safely
bootstrap to distinguish a live authenticated/anonymous flow from expiry.

Use nonsecret cross-tab notifications to invalidate local state and bootstrap again;
never broadcast tokens, grant handles, passwords or codes. A login/logout in another
tab changes the shared cookie; recover stale CSRF with bootstrap, then require a
deliberate resubmission of a failed write. Internal refresh/activity does not rotate
the cookie or CSRF. Serialize login/logout within the application; if concurrent
tabs race during bootstrap/login, reconcile instead of retrying credential writes.

If login's outcome is uncertain, bootstrap to learn the current state before another
deliberate attempt. If logout's outcome is uncertain, clear local protected exposure
and report **"Server sign-out could not be confirmed."** Keep the UI locked until
the user explicitly chooses recovery; an ordinary background bootstrap must not
silently restore protected content. Logout does not stop accepted coding runs or
sign out other independent browsers/direct bearer clients.

## Registration: Telegram OTP to account activation

Registration activates an existing identity; it is not public account creation.
An administrator first creates the identity with its phone and name (`PENDING`).
The user then opens the configured Telegram bot, starts it, and shares their own
contact using Telegram's contact button. Matching private self-contact links the
phone but leaves the identity PENDING. Use an environment-provided bot link;
no bot username/deep-link discovery API is provided by these authentication routes.

### Browser registration and recovery transport

Bootstrap an anonymous cookie before these flows. Already authenticated browsers
receive `409` on `/browser/auth/*`; sign out deliberately before changing credentials.
The following routes are implemented by the dedicated browser auth controller,
independently of the protected proxy allowlist. All successes are `200`.

| Browser method and path                                                 | JSON body / query                                                                                              | Success body                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/v1/browser/auth/registration/otp/send`                       | `{ "phoneNumber": "+998901234567", "locale": "UZ" }`                                                           | `{ "message": "OTP sent successfully." }`                                 |
| `POST /api/v1/browser/auth/registration/otp/verify`                     | `{ "phoneNumber": "+998901234567", "code": "123456" }`                                                         | `{ "temporaryToken": "<session-bound-handle>", "expiresInSeconds": 599 }` |
| `GET /api/v1/browser/auth/usernames/availability?username=ada.lovelace` | URL-encoded username; no body                                                                                  | `{ "username": "ada.lovelace", "available": true }`                       |
| `POST /api/v1/browser/auth/registration`                                | `{ "username": "ada.lovelace", "password": "Correct-Horse-42!", "passwordConfirmation": "Correct-Horse-42!" }` | `{ "message": "Registration completed successfully." }`                   |
| `POST /api/v1/browser/auth/password-reset/otp/send`                     | `{ "phoneNumber": "+998901234567", "locale": "EN" }`                                                           | `{ "message": "OTP sent successfully." }`                                 |
| `POST /api/v1/browser/auth/password-reset/otp/verify`                   | `{ "phoneNumber": "+998901234567", "code": "123456" }`                                                         | `{ "temporaryToken": "<session-bound-handle>", "expiresInSeconds": 599 }` |
| `POST /api/v1/browser/auth/password-reset`                              | `{ "password": "New-Correct-Horse-42!", "passwordConfirmation": "New-Correct-Horse-42!" }`                     | `{ "message": "Password reset completed successfully." }`                 |

All browser writes use JSON, current `X-CSRF-Token`, the anonymous cookie and exact
Origin. Send the verification response's 64-character base64url handle as
`X-Browser-Grant` **only** to the matching browser completion route. Never send it
as `Authorization`. It is bound to the anonymous browser, purpose and expiry;
`expiresInSeconds` is computed and bounded by both the ten-minute temporary grant
and the remaining anonymous lifetime (not always 600). Keep it only in memory;
bootstrap does not return it after reload. The bundle stores one grant, so a new
verification replaces the previous handle even when the purpose changes.

For example, final browser activation uses these headers (the browser supplies
Cookie and Origin; placeholders represent in-memory values):

```http
POST /api/v1/browser/auth/registration
Content-Type: application/json
X-CSRF-Token: <anonymous-csrf-token>
X-Browser-Grant: <session-bound-handle>

{ "username": "ada.lovelace", "password": "Correct-Horse-42!", "passwordConfirmation": "Correct-Horse-42!" }
```

Clear the handle after completion/cancellation. On expiry/reload, begin a deliberate
new verification flow. Registration and recovery return to sign-in; neither creates
an authenticated browser. Do not confuse these anonymous OTP flows with authenticated
OTP-only step-up, which takes no phone number and returns no temporary grant.

### Original registration endpoints

The original API contract remains available for direct clients. These paths do
not authenticate through the browser cookie. All return `200` on success. JSON
requests use `Content-Type: application/json`. Only final registration needs the
temporary Bearer header; public OTP/availability calls need no access token.

| Step                | Method and path                                                 | JSON body / query                                                                                              | Success body                                                            |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Send code           | `POST /api/v1/auth/registration/otp/send`                       | `{ "phoneNumber": "+998901234567", "locale": "UZ" }`                                                           | `{ "message": "OTP sent successfully." }`                               |
| Verify code         | `POST /api/v1/auth/registration/otp/verify`                     | `{ "phoneNumber": "+998901234567", "code": "123456" }`                                                         | `{ "temporaryToken": "<registration-token>", "expiresInSeconds": 600 }` |
| Check username      | `GET /api/v1/auth/usernames/availability?username=ada.lovelace` | URL-encoded `username` query                                                                                   | `{ "username": "ada.lovelace", "available": true }`                     |
| Finish registration | `POST /api/v1/auth/registration`                                | `{ "username": "ada.lovelace", "password": "Correct-Horse-42!", "passwordConfirmation": "Correct-Horse-42!" }` | `{ "message": "Registration completed successfully." }`                 |

Final request header: `Authorization: Bearer <registration-token>`.
The token is purpose-bound, expires in ten minutes, and is consumed on successful
registration. A new successful OTP verification revokes earlier unused temporary
tokens for the same user and purpose. Keep only the newest flow state.
Availability is advisory: registration can still return `409` if another user
claims the username. Debounce availability reads and discard stale results.

Success changes the account to `OPEN`; it does **not** create a browser session or
return login tokens. Clear activation state, then show sign-in.

### OTP timing and resend behavior

- Codes are six-digit **strings** delivered through Telegram, not SMS.
- Telegram messages tell users the code is valid for **one minute**. The backend's
  technical acceptance window is **five minutes**. Preserve this distinction in UI
  copy; the API does not return an OTP expiry timestamp or resend countdown.
- At most five failed attempts are allowed per code. Invalid, expired, consumed,
  and attempt-limited codes all return `401` with the same message.
- Sending another code invalidates previous unconsumed codes for that purpose.
  Ask users to enter the newest code.
- The service checks for three requests in the preceding ten minutes per user and
  purpose, then rejects another send with `429`. Do not invent a server-provided
  retry time; this implementation does not set `Retry-After` for that rejection.
- Sending writes the OTP before contacting Telegram. A delivery failure or lost
  response can still consume quota and invalidate the previous code. Avoid automatic
  resend; let the user check Telegram and deliberately request another code.

## Password recovery

The account must be `OPEN`, have username/password credentials, and have a verified
Telegram link. Use the registration flow's phone, locale, code validation, and
OTP timing rules. Browser clients use the `/browser/auth/password-reset*` routes
above. The following are the unchanged original direct-client paths:

| Step         | Method and path                               | JSON body                                                                                  | Success body                                                     |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Send code    | `POST /api/v1/auth/password-reset/otp/send`   | `{ "phoneNumber": "+998901234567", "locale": "EN" }`                                       | `{ "message": "OTP sent successfully." }`                        |
| Verify code  | `POST /api/v1/auth/password-reset/otp/verify` | `{ "phoneNumber": "+998901234567", "code": "123456" }`                                     | `{ "temporaryToken": "<reset-token>", "expiresInSeconds": 600 }` |
| Set password | `POST /api/v1/auth/password-reset`            | `{ "password": "New-Correct-Horse-42!", "passwordConfirmation": "New-Correct-Horse-42!" }` | `{ "message": "Password reset completed successfully." }`        |

All successes are `200`. Final request header:
`Authorization: Bearer <reset-token>`. A registration token cannot reset a password,
and a reset token cannot register an account. Do not send `username` in the reset body.

Successful reset consumes the temporary token, revokes **all refresh roots** and
sets the account revocation timestamp. Browser sessions fail their next validity
check; subsequent JWT guards reject prior access JWTs too, including pre-upgrade
unbound JWTs. Already accepted operations may complete. This applies through both
browser and original recovery routes. Clear recovery state and direct the user to
sign in again; do not claim that a passwordless account can set a password through
this flow, whose eligibility requires existing username/password credentials.

## Input validation

Unknown body fields are rejected by the global validation pipe. Do not send UI-only
fields such as `rememberMe`, terms acceptance, display name, or locale to login or
final registration/reset endpoints. Validate locally for feedback; server validation
remains authoritative.

| Field                      | Rule                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoneNumber`              | E.164 string matching `^\+[1-9]\d{7,14}$`; must also parse as a valid phone number. Combine country code and national digits; send no spaces or display punctuation.      |
| `locale`                   | Exactly uppercase `UZ`, `RU`, or `EN`; map UI language codes explicitly.                                                                                                  |
| `code`                     | String matching `^\d{6}$`; never convert it to a number.                                                                                                                  |
| `username`                 | Trimmed and lowercased by the backend; 3–32 ASCII characters, starts with a letter, then letters/digits/dot/underscore/hyphen. Pattern: `^[a-zA-Z][a-zA-Z0-9._-]{2,31}$`. |
| New `password`             | 12–128 characters; at least one ASCII lowercase, uppercase, digit, and non-alphanumeric character. Must not contain the username, case-insensitively.                     |
| `passwordConfirmation`     | Must exactly equal the new password.                                                                                                                                      |
| Login / step-up `password` | Required string, 1–128 characters. Do not apply new-password complexity validation to sign-in/confirmation, trim it, or change its case.                                  |

The password-reset form may not know the stored username; show the server's
username-in-password rejection when local validation cannot check it.

## Direct bearer API contract

This section is for clients that use the original API directly. It does not replace
the SPA's cookie session transport.

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "username": "ada.lovelace", "password": "Correct-Horse-42!" }
```

`200` response:

```json
{
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<opaque-refresh-token>"
}
```

Send `Authorization: Bearer <accessToken>` on original protected routes.
The access JWT lasts thirty minutes. The refresh token lasts thirty days.

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "<opaque-refresh-token>" }
```

`200` response: `{ "accessToken": "<new-jwt-access-token>" }`.
Refresh does **not** rotate the refresh token or extend its expiry. It needs no
access-token header; the JSON refresh token is the credential. Serialize concurrent
refresh attempts, and never automatically replay writes after refreshing.
It preserves the original login authentication age: a new access JWT alone does
not satisfy recent-authentication checks. Direct clients need a deliberate fresh
login for sensitive operations after ten minutes; browser step-up requires its
own cookie and cannot confirm a direct bearer session. A separately versioned
rotating direct-client refresh contract is not implemented. Newly issued JWTs are
root-bound for revocation; the older unbound-token caveat is described above.
There is no original `/auth/logout` or `/auth/me` endpoint. The browser logout
route revokes only its own browser session and bound refresh record.

Original `GET /api/v1/users/me/telegram-link` can read stored link status with an
access Bearer token, but is unavailable through the current browser proxy. It does
not verify live Telegram delivery or initiate linking/recovery. See
[stored link status](../self-telegram-link-contracts.md).

## Errors and recovery decisions

Authentication generally uses the standard Nest error envelope. `message` can be
a string or an array of validation strings. `RECENT_AUTH_REQUIRED` is the explicit
step-up code; most other auth failures have no stable domain code. Its custom
response can omit the usual `error` property, so keep that property optional.

```json
{
  "statusCode": 401,
  "message": "Invalid username or password",
  "error": "Unauthorized"
}
```

| Status / context                          | Frontend behavior                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` validation                          | Show field/general feedback; preserve nonsecret input. Includes invalid phone, extra properties, password mismatch, or password containing username.                                      |
| `401` login                               | Show generic credential rejection; do not infer BANNED/DELETED or reveal account existence.                                                                                               |
| `401` OTP / temporary token               | Show invalid/expired flow feedback. Offer a deliberate fresh code flow when needed; do not auto-retry verification or final submission.                                                   |
| `401` step-up password / OTP              | Show confirmation rejection. Cookie expiry can also return `401`; bootstrap safely if uncertain. Preserve a still-valid session instead of treating every confirmation failure as logout. |
| `401` protected browser request           | Clear protected state, abort old work, bootstrap for a fresh anonymous/session view, and show sign-in when anonymous.                                                                     |
| `401` direct refresh                      | Credentials cannot refresh; clear direct-client auth state and sign in again.                                                                                                             |
| `403` registration/recovery OTP send      | After excluding browser Origin/CSRF rejection, guide the user to share their matching self-contact with the configured Telegram bot.                                                      |
| `403` with `code: RECENT_AUTH_REQUIRED`   | Keep the session, prompt the advertised step-up method, install successful metadata, then wait for deliberate action retry.                                                               |
| `403` OTP step-up                         | Password verification is required, no verified passwordless method exists, or browser protections rejected the request. Recheck metadata; do not offer an OTP bypass.                     |
| `403` browser route                       | Handle origin/JSON/CSRF rejection; re-bootstrap stale CSRF when appropriate. Do not replay the write automatically.                                                                       |
| `403` protected resource                  | Show denied access; this is not evidence that the entire session is invalid.                                                                                                              |
| `404` original OTP send                   | The phone must first be registered by an administrator. For browser OTP send, also distinguish feature unavailability.                                                                    |
| `404` browser route                       | Check environment enablement and proxy allowlist; do not treat as successful logout or an empty account.                                                                                  |
| `404` device revoke                       | The UUID is absent or not owned; do not reveal another account's session. Refresh the owned-device list.                                                                                  |
| `409` browser login / anonymous auth flow | This browser is already authenticated. Reconcile session state and require deliberate sign-out before changing credentials/accounts.                                                      |
| `409` registration/reset                  | Username may be taken or the account cannot perform this flow. Registration success is not implied; reread advisory availability where useful.                                            |
| `429` OTP send                            | Show a rate-limit state and allow a later deliberate retry. Do not start an automatic resend loop.                                                                                        |
| `429` password step-up                    | Device confirmation is temporarily blocked after repeated failures. Allow a later deliberate retry; do not automatically retry or log out other devices.                                  |
| `503` auth/session dependency             | Preserve signed-in context without claiming fresh permissions/data; show unavailable/retry feedback. Never convert to anonymous/empty-data success.                                       |
| Network failure, timeout, other `5xx`     | Outcome may be unknown, especially for writes. Stop loading, preserve useful nonsecret input, and offer explicit recovery. Never assume a write failed or automatically replay it.        |

The auth dependency `503` message is `Authentication is temporarily unavailable`;
browser storage/upstream failures use their own sanitized messages. OTP Telegram
configuration failure can also return `503`; other delivery failures are not
guaranteed to share that classification. Use HTTP status and flow context, and
localize UI copy rather than relying on matching every English message.
See [authentication availability](../authentication-availability-contracts.md).

## Migration and frontend integration checklist

Implement and test against an authorized local environment before opting in. The
checklist describes required integration work, not completed changes to the actual
frontend or a production rollout.

- Reload restores state from bootstrap, including signed-in accounts with no grants.
- Keep the policy header gated until all rolling behavior below passes. Without
  it, login stays capped. Verify unknown policy rejection and a server-configured
  shorter/capped profile; honor the response instead of assuming 90 days.
- Existing capped sessions stay capped until expiry or deliberate logout/new login.
  Never rewrite client timestamps or automatically relogin to upgrade a session.
- Parse `expiryPolicy`, nullable `hardExpiresAt`, `authenticatedAt` and
  `reauthenticationMethod`; preserve legacy timestamp handling for an older server.
  A rolling `absoluteExpiresAt` moves with idle expiry and is not a fixed cap.
- Login rotates CSRF/cookie; ordinary renewal preserves them. Logout, single-device
  revoke and revoke-all handle empty `204`; cookies remain HttpOnly. Self-revoke
  locks this UI; revoking a different device leaves the current one signed in.
- Foreground activity posts `{}` with CSRF, at most once per minute. Reading and
  interaction renew appropriately; background tabs, polling, SSE and bootstrap do
  not. A lost activity acknowledgement is reconciled by a safe read.
- Replace stale deadlines after activity/step-up and bootstrap after relevant
  foreground writes. Test long durations beyond eight hours and thirty days,
  timer clamping, wake/visibility restoration and exact inactivity/cap expiry.
- Concurrent protected reads across tabs do not expose tokens or cause duplicate
  internal refresh. After uncertain refresh `503`, safe reads recover with the same
  cookie. Expired/replayed/revoked credentials never resurrect through renewal.
- Exercise stale authentication, correct/wrong password, five-failure blocking,
  passwordless session-bound OTP, resend/attempt limits, wrong-device/purpose code
  rejection and `unavailable`. Password accounts cannot use OTP instead. A sensitive
  action waits for a deliberate retry after confirmation; permissions still apply.
- Verify the bounded device-list response, foreign/absent UUID `404`, invalid UUID
  `400`, other-device revoke, current-device revoke and revoke-all. Do not invent
  device labels or claim more than the returned 100 roots are enumerated.
- Wrong credentials, bad/stale CSRF, unavailable service, and disabled browser routes
  produce distinct UI states. `503` does not clear identity as if it were `401`.
- Protected data, requests, and streams are cleared on logout/session expiry;
  late responses and cross-tab changes cannot restore an old account's content.
- An uncertain login is reconciled by bootstrap. An uncertain logout stays locked
  with an explicit notice; neither mutation is replayed automatically.
- Activation/reset uses `/browser/auth/*` plus the anonymous cookie/CSRF and matching
  `X-Browser-Grant`, never browser Bearer credentials. Exercise missing identity,
  missing Telegram contact, newest-code behavior, five failed attempts, rate limits,
  grant/session expiry, reload and wrong-browser/purpose handles.
- Username normalization, advisory availability races, password confirmation,
  locale mapping, and E.164 submission agree with the backend contract.
- Successful registration/reset returns to sign-in. Reset invalidates other browser
  sessions and previously issued JWTs on subsequent checks. Role/membership removal
  denies affected resources without assuming the whole account is signed out.
- Stream closure triggers safe session/resource reconciliation and cursor-based
  reconnect, with no resource-write replay and no assumption that the run stopped.
- Use designated test identities for OTP testing: sends deliver real Telegram
  messages. Controlled browser fixture checks do not establish live OTP delivery.

Deployment is a separate gate. The backend feature remains disabled by default;
no deployment, migration or secret provisioning was performed by this update.
Operators must review backup/restore and both additive migrations
([rolling sessions](../../prisma/migrations/20261024110000_rolling_browser_sessions/migration.sql),
[browser step-up OTP](../../prisma/migrations/20261024120000_browser_stepup_otp/migration.sql)),
configure the exact same-origin HTTPS routing and independent server-only AEAD key,
and verify the actual target environment before enabling clients. Never ship key
material in frontend configuration. Retained keys must remain available while live
bundles/challenges need them. Rollback must keep managed-root/revocation validation;
turning off new rolling issuance does not convert existing sessions. Production
retention/cleanup and historical damaged-fixture preservation are not established
by local synthetic tests. See the
[migration/rollback and operations contract](../rolling-authentication-contracts.md#key-retention-migration-and-rollback)
and [final verification limits](../rolling-auth-implementation-checkpoint-20261024.md#handoff-and-rollout-limits).

## Contract sources and verification scope

This guide was checked against the current controller/DTO/service/guard implementation,
not a live deployment. It introduces documentation only. No OTP was sent and no
account, session, production configuration, or deployment was changed. The preceding
backend verification recorded **2,137 passing tests across 110 suites**; this task
does not rerun those runtime suites or claim real-browser integration evidence for
the rolling frontend. See the checkpoint's final-verification section for scope.

- [Authentication routes](../../src/auth/auth.controller.ts),
  [DTOs](../../src/auth/auth.dto.ts), and [service](../../src/auth/auth.service.ts).
- [Browser routes and allowlist](../../src/browser-sessions/browser-session.controller.ts),
  [activation/recovery routes](../../src/browser-sessions/browser-auth.controller.ts),
  [step-up DTOs](../../src/browser-sessions/browser-session.dto.ts),
  [session behavior](../../src/browser-sessions/browser-session.service.ts), and
  [configuration](../../src/browser-sessions/browser-session.config.ts).
- [Access/recent-auth guards](../../src/auth/auth.guards.ts),
  [stream session authority](../../src/auth/session-authority.ts), and
  [rolling behavior tests](../../test/rolling-auth.http.spec.ts).
- [API validation and prefix](../../src/main.ts) and
  [OpenAPI export](../api/openapi.json). The checked-in export is a release snapshot
  and may lag these local rolling routes/fields; current source and this guide are
  authoritative for this local integration. A running configured server exposes
  Swagger at `/api/v1/docs`; it is not evidence that browser sessions are enabled.
- [Controlled local browser handoff](../browser-session-handoff-20261019.md) for
  historical isolated-fixture instructions only. Follow the current checkpoint's
  fixture ownership/limitations before any separately authorized test run; do not
  use those older instructions to access the sibling frontend during this task.
