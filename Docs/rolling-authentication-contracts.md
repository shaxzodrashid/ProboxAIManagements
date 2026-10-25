# Persistent device authentication — local backend contract

This is a local implementation. It does not deploy a server, provision secrets,
change existing accounts or migrate production data. Frontend rollout remains a
separate integration gate; see the implementation checkpoint for actual evidence.

## Policy and compatibility

Upgraded clients send `X-Browser-Session-Policy: rolling-v1` on browser login,
only after implementing foreground activity and long-duration deadline handling.
Without that header, new browser logins keep a compatibility profile of at most
30 minutes idle / eight hours absolute (or a shorter configured limit). Unknown
policy header values are rejected. Existing clients do not silently opt into the
new long-duration policy.

Opted-in ordinary trusted-browser sessions use a server-enforced inactivity deadline,
defaulting to 90 days, without an absolute calendar deadline. Access JWTs remain
30 minutes. Each foreground renewal advances inactivity; automatic access refresh,
GET/bootstrap, SSE polling and transport heartbeats do not count as activity.
Once a deadline has expired, no activity, refresh or bootstrap can revive that row.
Bootstrap may issue a separate anonymous session for deliberate sign-in.

`BROWSER_SESSION_IDLE_MS` permits integer durations from 1 second to 365 days.
`BROWSER_SESSION_ABSOLUTE_MS=0` selects rolling policy; an explicit nonzero value
within the same limits enables a capped profile. Absolute policy is stored at
login, so changing it cannot convert existing capped sessions to rolling. New
sessions also snapshot inactivity policy in their encrypted bundle. Pre-existing
bundles without that field use configured inactivity when renewed, still bounded
by their original absolute deadline. Changed configuration never revives expired rows.
Anonymous sessions remain 10 minutes by default, configurable up to 30 minutes.

No account, role, resource permission or membership is granted by renewal.
The current persisted account/workspace and original resource authorization
continue to govern every request. Removing a role or membership must take effect
on the next relevant authorization check even while the device remains signed in.

The direct `/auth/login` and `/auth/refresh` JSON shapes remain unchanged. Direct
clients retain fixed 30-day, nonrotating refresh tokens. They are not silently
upgraded to browser-managed credentials. Newly issued direct JWTs include the
refresh-row ID, permitting immediate device revocation. JWTs issued before this
implementation lack that binding: per-device revocation cannot identify those
tokens, and they age out within their original 30 minutes. Password reset and
revoke-all additionally reject old JWTs through an account revocation timestamp.
No OTP login or new password/MFA bypass is introduced.

The browser keeps one opaque HttpOnly cookie (`Secure`, `SameSite=Lax`, `/`, no
Domain in HTTPS). Raw access/refresh credentials remain in an AEAD-encrypted server
bundle. The same opaque cookie survives renewal, so lost refresh acknowledgements
and concurrent tabs can recover the committed bundle without receiving a new
refresh credential. A copied browser cookie is still a bearer credential: this is
not hardware/device attestation. Inactivity alone cannot stop an attacker who can
keep a stolen session active; revocation, transport protection and sensitive-action
verification remain necessary. Clearing browser cookies still requires sign-in.

## Browser endpoints

All paths are below `/api/v1/browser`. Reads are no-store. Writes require the exact
configured Origin, JSON and current in-memory `X-CSRF-Token`; unknown body fields
are rejected. Credentials must never be placed in URLs, telemetry or browser
persistent storage.

| Endpoint                         | Request / result                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET session`                    | Current identity/permissions and deadlines, or anonymous bootstrap. Does not renew activity.                                                |
| `POST activity`                  | Exactly `{}`. Renew foreground activity and cookie; return fresh session metadata.                                                          |
| `GET devices`                    | At most 100 active owned refresh roots, newest first. IDs, creation/deadline/current flag only; never token hashes or raw credentials.      |
| `POST devices/:id/revoke`        | Exactly `{}` and an owned UUID; revoke one device root. Other accounts return `404`. Requires recent authentication.                        |
| `POST devices/revoke-all`        | Exactly `{}`; revoke all owned refresh roots, set the account revocation timestamp, clear this cookie. Requires recent authentication.      |
| `POST reauthenticate`            | `{password}` for the current password-bearing account. Success refreshes authentication age and activity, not permissions.                  |
| `POST reauthenticate/otp/send`   | `{locale: "EN"                                                                                                                              | "RU" | "UZ"}` for an already authenticated passwordless account with a stored verified Telegram link. No caller-supplied phone or recipient. |
| `POST reauthenticate/otp/verify` | `{code}`. Six digits, session-bound, five-minute lifetime, single use, five failed attempts. Success refreshes authentication age/activity. |
| `POST logout`                    | Existing `{}` contract; revoke this device root and clear its cookie.                                                                       |

Authenticated responses add `expiryPolicy` (`rolling`/`absolute`), `hardExpiresAt`
(`null` for rolling), `authenticatedAt` and `reauthenticationMethod` (`password`,
`telegram-otp`, `unavailable`). `idleExpiresAt` remains authoritative. For wire-shape
compatibility, `absoluteExpiresAt` remains a timestamp string; under rolling policy
it aliases the current inactivity deadline, not a fixed session-age limit. New
clients must use `hardExpiresAt` and `expiryPolicy` to distinguish these concepts.

Password failures are counted under the browser row lock: five failures block that
device's password confirmation for ten minutes. Passwordless code delivery is
limited to three requests per device in ten minutes; resend invalidates the older
code for that device. Codes bind the device digest and have a separate purpose;
registration/reset codes or grants cannot satisfy this check. A password-bearing
account is refused by both OTP step-up endpoints. Accounts lacking any verified
method retain normal access but cannot perform sensitive actions until an approved
authentication method is established; this code does not invent recovery policy.

Role/permission administration and user-management mutations require authentication
within ten minutes, as do device revocation operations. Stale authentication returns
`403` with `code: RECENT_AUTH_REQUIRED`; it is not an account logout. Step-up is
bound to the current account, never an account-switch mechanism. The current source
has no separate mandatory MFA factor model; any future MFA requirement must be
composed with this policy, not replaced by a successful OTP or password alone.

## Rotation, concurrency and error boundaries

`SessionToken` is the stable device-family root. Browser roots are marked managed;
the legacy refresh endpoint refuses them. `RefreshCredential` stores only hashes,
creation and consumption state. Browser refresh locks its session and root, consumes
the current credential, inserts its successor and writes the encrypted bundle in
one transaction. Concurrent tabs read the committed successor. A consumed or foreign
credential inside a managed bundle commits root revocation before returning `401`.

An unknown commit acknowledgement returns sanitized `503`; do not replay a resource
mutation. A later safe read with the same cookie discovers the committed state.
Failed transactions consume nothing. Login's uncertain-outcome cleanup revokes only
the newly issued root if present. Revocation and refresh serialize on the stable
root; renewal never clears revocation. Device IDs do not authorize access by
themselves. In-flight requests accepted before revocation may complete; subsequent
request guards reject the revoked root even if its JWT has not expired.

Both persisted SSE paths recheck current resource authority and device validity
before each batch. Ordinary polling is 500ms plus database/network time; an already
accepted batch is bounded by the existing stream page size. Browser proxy streams
also recheck the browser every five seconds and close at their initial access/idle
deadline. These are polling bounds, not a hard real-time SLA. Dependency failures
close streams without extending activity; clients reconcile persisted state. There
is no WebSocket server in the inspected backend. Logout does not interrupt accepted
coding runs. No automatic replay is permitted after a stream closes.

## Frontend integration gate

Attach activity reporting only after authenticated bootstrap. Use trusted foreground
pointer/keyboard/scroll activity while the document is visible, throttled to at most
one report per minute, including meaningful reading. Do not send activity from an
interval, polling, SSE heartbeat or merely an open tab. Such signals improve UX;
the server cannot prove a human is present from a client assertion.

After renewal, publish fresh deadlines to protected screens without clearing their
identity or permissions optimistically. Bootstrap/reconcile after uncertain renewal.
Clamp timer delays to the platform maximum (2,147,483,647ms) and recheck on wake or
visibility changes; a 90-day timeout passed directly to `setTimeout` can overflow.
Cross-tab hints must contain no credentials and trigger a safe session reread.

Handle `RECENT_AUTH_REQUIRED` with the server-advertised method. Submit the original
sensitive action only on a deliberate user retry after confirmation; never silently
replay a possibly accepted mutation. Clear password/code fields after completion or
cancellation. Keep transient `503`, `403` permission loss and confirmed `401` session
expiry distinct. The actual sibling client is unchanged: the user explicitly
deferred frontend access and editing. It must implement these rules before sending
the rolling policy header. Legacy browser login remains capped in the meantime.

## Key retention, migration and rollback

New bundles use `BROWSER_SESSION_KEY_ID` and the independent active 32-byte key.
`BROWSER_SESSION_PREVIOUS_KEYS` accepts a JSON object of at most five original key
IDs to independent base64url keys. Retained keys decrypt old bundles and pending
step-up codes; authenticated proxy use rewrites bundles with the active key. Do not
remove a retained key while any live bundle/challenge still needs it. Never log key
values or include them in a public frontend build. No key provisioning or settings
changes were performed by this implementation.

Both migrations are additive. Old managed/rolling flags default false; existing
deadlines, credentials and published/business data are not rewritten. Expired
legacy rows are never adopted into rolling sessions. Validate on a restored
synthetic copy, compare all original columns, and authorize production migration
separately. The retained historical fixture is damaged; successful preservation
evidence here is against the fresh, seeded synthetic baseline only.

Rollback must preserve new revocation checks and managed-family handling while
active managed sessions exist. Do not roll back to an old binary that ignores
these fields or drop the credential table while roots remain live. To stop new
rolling issuance, deploy a capped profile for new sessions while retaining this
backend's validators; any decision to revoke existing devices is a separate action.
Retain the additive columns/tables until all dependent sessions are expired or
explicitly revoked and a reviewed rollback has been validated. No automatic data
deletion, down migration or destructive reconciliation is implemented.

## Retention and operations

Expired/revoked rows cannot authorize even before cleanup. Keep consumed credential
hashes for each live family so an old credential cannot become acceptable again.
After a root is expired/revoked, retain minimal audit/tombstone evidence according
to the approved retention window, then purge in bounded batches only after a
separately authorized backup/retention procedure. Foreign-key cascades from a root
also remove its browser bundle and credential hashes; review that scope before
purging. Never delete a live root, clear `consumedAt`, or resurrect expired rows to
repair an uncertain outcome. A purge scheduler/production retention window is not
activated by this work. Monitor bounded device/root counts, consumed-hash growth,
renewal/replay/revocation outcomes and sanitized logout reasons, without credentials
or message/document content. Continuous active sessions accumulate rotation history;
capacity planning and batching remain operator responsibilities before rollout.
