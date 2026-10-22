# Authentication APIs: frontend integration guide

Reviewed against repository source on **21 October 2026**. All paths include the
`/api/v1` prefix. JSON property names are **camelCase**. Examples are illustrative,
not live credentials or captured production responses.

## Choose the correct transport

| Client / flow                              | Contract                                                     | Credential handling                                              |
| ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Browser SPA sign-in and protected requests | `/api/v1/browser/*`                                          | HttpOnly session cookie; CSRF token in memory                    |
| Registration and password recovery         | `/api/v1/auth/registration*`, `/api/v1/auth/password-reset*` | Public OTP requests, then a purpose-bound temporary Bearer token |
| Existing direct API clients                | `/api/v1/auth/login`, `/api/v1/auth/refresh`                 | JWT access token and opaque refresh token                        |

Use the browser session contract for SPA login. It keeps access and refresh tokens
on the server. Do not store passwords, OTPs, temporary tokens, access/refresh tokens,
or CSRF tokens in localStorage, sessionStorage, IndexedDB, URLs, analytics, or logs.
Keep sensitive form and session state in memory and clear it when the flow ends.

**Availability boundary:** browser sessions are implemented but disabled by default
(`BROWSER_SESSIONS_ENABLED=true` enables them). This guide does not establish that
they are enabled on any deployed environment. Their routes return `404` when
disabled. Production requires same-origin HTTPS routing and server configuration;
see [browser session configuration](../browser-session-local-implementation.md).
Do not fall back to storing bearer credentials in the SPA if browser login is unavailable.

Registration/reset APIs exist, but the browser proxy does **not** expose them.
Their temporary-token transport remains unwired in the documented frontend slice.
Integrating those screens needs an explicitly configured transport to the original
routes. There is no credentialed cross-origin CORS setup in `src/main.ts`.
Do not assume the browser cookie authenticates original `/api/v1/*` routes.

## Browser sign-in, restore, and logout

All browser URLs must use the frontend's origin. Use relative URLs and
`credentials: "same-origin"`; a local development proxy must preserve this contract.
Every response is `Cache-Control: no-store`; exclude these URLs from service worker
and application response caches.

| Method and path               | Request                                                           | Success                                                                                  |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/v1/browser/session` | No body                                                           | `200`: anonymous or authenticated session                                                |
| `POST /api/v1/browser/login`  | `{ "username": "ada.lovelace", "password": "Correct-Horse-42!" }` | `200`: authenticated session; rotates cookie and CSRF token                              |
| `POST /api/v1/browser/logout` | Exactly `{}`                                                      | `204`: no response body; clears cookie and revokes this browser's session/refresh record |

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
  "csrfExpiresAt": "2026-10-21T10:10:00.000Z"
}
```

Authenticated response from bootstrap or login:

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
  "idleExpiresAt": "2026-10-21T10:30:00.000Z",
  "absoluteExpiresAt": "2026-10-21T18:00:00.000Z"
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
`users/me/telegram-link`, original authentication routes, and profile/admin mutations
are not currently allowed. Unsupported proxy paths return `404`. Check
[`browserProxyAllowed`](../../src/browser-sessions/browser-session.controller.ts)
before integrating another resource; its original DTO and permission checks still apply.

Default lifetimes are ten minutes for anonymous sessions, thirty minutes idle,
and eight hours absolute for authenticated sessions. Server configuration can change
them; use returned deadlines. Bootstrap, GET polling, and SSE do not extend idle
expiry. The proxy currently touches idle expiry on allowed non-GET resource requests.
Re-bootstrap when current displayed deadlines are needed; mutation responses do not
include updated browser session metadata. Absolute expiry never slides.

Access-token refresh is handled on the server when needed by protected proxy
requests. The SPA does not call `/auth/refresh` for browser sessions. SSE may close
at an authorization deadline; stream EOF is not session-work completion. Recheck
session state and reconcile persisted resource state before reconnecting.

### Request and state handling

The following request shapes assume `session` is the current in-memory bootstrap
result and that the UI handles non-success HTTP responses:

```ts
const bootstrapResponse = await fetch("/api/v1/browser/session", {
  credentials: "same-origin",
  cache: "no-store",
});
if (!bootstrapResponse.ok) throw new Error("Session bootstrap failed");
const session = await bootstrapResponse.json();

const loginResponse = await fetch("/api/v1/browser/login", {
  method: "POST",
  credentials: "same-origin",
  cache: "no-store",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  },
  body: JSON.stringify({ username, password }),
});
// Check status; on 200 validate and install the new session, including csrfToken.
// Never automatically replay login after a timeout or a lost acknowledgement.
```

Centralize session state in the transport layer. Tag requests with an authentication
generation; abort old requests and discard late results after logout, account change,
or a new session. Clear protected caches and streams on a confirmed session `401`.
A `401` from login means rejected credentials; a `401` from OTP verification means
an invalid code. Do not apply protected-session logout logic to those public flows.

Use nonsecret cross-tab notifications to invalidate local state and bootstrap again;
never broadcast tokens. After another tab rotates the cookie, recover a stale CSRF
token with bootstrap, then require a deliberate resubmission of a failed write.

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

All endpoints below return `200` on success. JSON requests use
`Content-Type: application/json`. Only the final registration request needs the
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
OTP timing rules, with these paths:

| Step         | Method and path                               | JSON body                                                                                  | Success body                                                     |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Send code    | `POST /api/v1/auth/password-reset/otp/send`   | `{ "phoneNumber": "+998901234567", "locale": "EN" }`                                       | `{ "message": "OTP sent successfully." }`                        |
| Verify code  | `POST /api/v1/auth/password-reset/otp/verify` | `{ "phoneNumber": "+998901234567", "code": "123456" }`                                     | `{ "temporaryToken": "<reset-token>", "expiresInSeconds": 600 }` |
| Set password | `POST /api/v1/auth/password-reset`            | `{ "password": "New-Correct-Horse-42!", "passwordConfirmation": "New-Correct-Horse-42!" }` | `{ "message": "Password reset completed successfully." }`        |

All successes are `200`. Final request header:
`Authorization: Bearer <reset-token>`. A registration token cannot reset a password,
and a reset token cannot register an account. Do not send `username` in the reset body.

Successful reset consumes the temporary token and revokes **all refresh tokens**
for the account. Browser sessions bound to them fail their next validity check.
Existing direct access JWTs retain their prior validity until expiry unless current
account checks reject them; password reset does not immediately revoke every JWT.
Clear recovery state and direct the user to sign in again.

## Input validation

Unknown body fields are rejected by the global validation pipe. Do not send UI-only
fields such as `rememberMe`, terms acceptance, display name, or locale to login or
final registration/reset endpoints. Validate locally for feedback; server validation
remains authoritative.

| Field                  | Rule                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoneNumber`          | E.164 string matching `^\+[1-9]\d{7,14}$`; must also parse as a valid phone number. Combine country code and national digits; send no spaces or display punctuation.      |
| `locale`               | Exactly uppercase `UZ`, `RU`, or `EN`; map UI language codes explicitly.                                                                                                  |
| `code`                 | String matching `^\d{6}$`; never convert it to a number.                                                                                                                  |
| `username`             | Trimmed and lowercased by the backend; 3–32 ASCII characters, starts with a letter, then letters/digits/dot/underscore/hyphen. Pattern: `^[a-zA-Z][a-zA-Z0-9._-]{2,31}$`. |
| New `password`         | 12–128 characters; at least one ASCII lowercase, uppercase, digit, and non-alphanumeric character. Must not contain the username, case-insensitively.                     |
| `passwordConfirmation` | Must exactly equal the new password.                                                                                                                                      |
| Login `password`       | Required string, 1–128 characters. Do not apply new-password complexity validation to sign-in, trim it, or change its case.                                               |

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
There is no original `/auth/logout` or `/auth/me` endpoint. The browser logout
route revokes only its own browser session and bound refresh record.

Original `GET /api/v1/users/me/telegram-link` can read stored link status with an
access Bearer token, but is unavailable through the current browser proxy. It does
not verify live Telegram delivery or initiate linking/recovery. See
[stored link status](../self-telegram-link-contracts.md).

## Errors and recovery decisions

Authentication uses the standard Nest error envelope. `message` can be a string
or an array of validation strings; stable domain codes are not guaranteed here.

```json
{
  "statusCode": 401,
  "message": "Invalid username or password",
  "error": "Unauthorized"
}
```

| Status / context                      | Frontend behavior                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` validation                      | Show field/general feedback; preserve nonsecret input. Includes invalid phone, extra properties, password mismatch, or password containing username.                               |
| `401` login                           | Show generic credential rejection; do not infer BANNED/DELETED or reveal account existence.                                                                                        |
| `401` OTP / temporary token           | Show invalid/expired flow feedback. Offer a deliberate fresh code flow when needed; do not auto-retry verification or final submission.                                            |
| `401` protected browser request       | Clear protected state, abort old work, bootstrap for a fresh anonymous/session view, and show sign-in when anonymous.                                                              |
| `401` direct refresh                  | Credentials cannot refresh; clear direct-client auth state and sign in again.                                                                                                      |
| `403` OTP send                        | Guide the user to share their matching self-contact with the configured Telegram bot.                                                                                              |
| `403` browser route                   | Handle origin/JSON/CSRF rejection; re-bootstrap stale CSRF when appropriate. Do not replay the write automatically.                                                                |
| `403` protected resource              | Show denied access; this is not evidence that the entire session is invalid.                                                                                                       |
| `404` OTP send                        | Explain that the phone must first be registered by an administrator.                                                                                                               |
| `404` browser route                   | Check environment enablement and proxy allowlist; do not treat as successful logout or an empty account.                                                                           |
| `409` registration/reset              | Username may be taken or the account cannot perform this flow. Registration success is not implied; reread advisory availability where useful.                                     |
| `429` OTP send                        | Show a rate-limit state and allow a later deliberate retry. Do not start an automatic resend loop.                                                                                 |
| `503` auth/session dependency         | Preserve signed-in context without claiming fresh permissions/data; show unavailable/retry feedback. Never convert to anonymous/empty-data success.                                |
| Network failure, timeout, other `5xx` | Outcome may be unknown, especially for writes. Stop loading, preserve useful nonsecret input, and offer explicit recovery. Never assume a write failed or automatically replay it. |

The auth dependency `503` message is `Authentication is temporarily unavailable`;
browser storage/upstream failures use their own sanitized messages. OTP Telegram
configuration failure can also return `503`; other delivery failures are not
guaranteed to share that classification. Use HTTP status and flow context, and
localize UI copy rather than relying on matching every English message.
See [authentication availability](../authentication-availability-contracts.md).

## Frontend acceptance checklist

- Reload restores state from bootstrap, including signed-in accounts with no grants.
- Login rotates CSRF; logout handles empty `204`; cookies remain HttpOnly.
- Wrong credentials, bad/stale CSRF, unavailable service, and disabled browser routes
  produce distinct UI states. `503` does not clear identity as if it were `401`.
- Protected data, requests, and streams are cleared on logout/session expiry;
  late responses and cross-tab changes cannot restore an old account's content.
- An uncertain login is reconciled by bootstrap. An uncertain logout stays locked
  with an explicit notice; neither mutation is replayed automatically.
- Activation/reset transport is confirmed before connecting their screens. Exercise
  missing identity, missing Telegram contact, newest-code behavior, five failed
  attempts, rate limits, temporary-token expiry, and wrong-purpose tokens.
- Username normalization, advisory availability races, password confirmation,
  locale mapping, and E.164 submission agree with the backend contract.
- Successful registration/reset returns to sign-in. Reset invalidates bound browser
  sessions on their next check without claiming immediate revocation of all JWTs.
- Use designated test identities for OTP testing: sends deliver real Telegram
  messages. Controlled browser fixture checks do not establish live OTP delivery.

## Contract sources and verification scope

This guide was checked against the current controller/DTO/service implementation,
not a live deployment. It introduces documentation only. No OTP was sent and no
account, session, production configuration, or deployment was changed.

- [Authentication routes](../../src/auth/auth.controller.ts),
  [DTOs](../../src/auth/auth.dto.ts), and [service](../../src/auth/auth.service.ts).
- [Browser routes and allowlist](../../src/browser-sessions/browser-session.controller.ts),
  [session behavior](../../src/browser-sessions/browser-session.service.ts), and
  [configuration](../../src/browser-sessions/browser-session.config.ts).
- [API validation and prefix](../../src/main.ts) and
  [OpenAPI export](../api/openapi.json). A running configured server exposes Swagger
  at `/api/v1/docs`; it is not evidence that the browser session feature is enabled.
- [Controlled local browser handoff](../browser-session-handoff-20261019.md) for
  existing isolated fixture startup and verification instructions.
