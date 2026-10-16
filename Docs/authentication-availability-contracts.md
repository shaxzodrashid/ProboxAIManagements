# Authentication availability classification (MAIN03 bounded capability)

Protected HTTP requests and public profile requests with supplied authorization
retain credential rejection as 401: missing/malformed bearer credentials,
verified invalid signature or token claims, expired/not-yet-active JWTs,
wrong-purpose/missing-identity payloads, or a successful lookup with no OPEN
account. Missing persisted identity does not reveal a lifecycle reason.
Insufficient permissions remain 403; current account workspace and grants still
come from the database, never stale JWT workspace/role claims.

JWT verification key/provider/configuration failures and failed identity lookups
now return 503, with exactly the standard Nest error envelope:

```json
{
  "statusCode": 503,
  "message": "Authentication is temporarily unavailable",
  "error": "Service Unavailable"
}
```

The response contains no dependency exception, credentials, storage path,
database identifiers, token or rejection cause. Verifier credential errors are
allowlisted from the installed library's classes/messages; key/provider/options
errors can share `JsonWebTokenError` and are not blanket-classified as 401.
Unexpected verifier failures remain unavailable.
Malformed token JSON can cause a verifier `SyntaxError`; a separate serialization
check confirms malformed header/payload JSON before calling it credential rejection.
That check never supplies authenticated claims. An unexpected verifier `SyntaxError`
with valid token serialization remains 503.
Database errors are classified
by their dependency phase, even if they resemble JWT errors. Both synchronous
throws and asynchronous rejection are sanitized. No request handler runs after
an authentication guard failure.

Optional authentication permits anonymous access only when the authorization
header is absent. Empty, malformed or rejected credentials return 401; failed
verification or identity dependencies return 503 and never downgrade to an
anonymous profile read. Public profile field/audience evaluation is unchanged.

`POST /api/v1/auth/refresh` now returns the same sanitized 503 for failed token
lookup or access-token signing. Successfully read missing, wrong-purpose,
revoked, consumed, expired or non-OPEN token records retain 401. Refresh failure
does not rotate, revoke, consume or create tokens. Success still returns only
a new 30-minute access token; existing refresh lifetime and no-rotation behavior
remain unchanged. No sign-out/revocation/recovery policy is added. Login,
registration, OTP and password-reset flows are outside this bounded change.

Clients should preserve signed-in context on 503 and allow a later retry; 503 is
not evidence of invalid credentials, anonymous identity, zero grants or empty
resource data. Do not infer account lifecycle from 401. Error responses do not
claim when infrastructure will recover and introduce no automatic retry loop.

Shared `ApiAuthenticationErrors` and the refresh operation document 503 alongside
401/403 as appropriate. The real HTTP regressions in
`test/authentication-availability.http.spec.ts` use actual JWT signing/verification
and injected dependency failures. They check exact sanitized envelopes, blocked
handler entry, optional-header behavior, credential categories, refresh negative
states, unchanged success lifetime and OpenAPI response contracts. No migration,
data rewrite, grant change, provider call or production configuration is needed.
This completes authentication availability classification locally; MAIN03's
broader Home composition/count/cache requirements remain partial.

Local verification: 568 tests in 44 suites passed, with isolated persistence
enabled on `127.0.0.1:55439/profile_test`; 39 new HTTP cases cover this capability.
Typecheck, ESLint (zero warnings), Prettier, Nest build and diff checks passed.
Independent review found and rechecked the malformed-JSON case; no outstanding
finding remains. Existing invalid/expired credential fixtures now use actual
JWT error types while retaining their 401 expectations; the role OpenAPI test
asserts the authentication-specific 503. A post-authentication profile-service
failure still follows its existing sanitized 500 contract, outside this scope.
The isolated database was stopped after verification. No migration was added.

Changed files in this batch (earlier cumulative changes are preserved):

- `src/auth/authentication-failures.ts`
- `src/auth/auth.guards.ts`
- `src/auth/auth.service.ts`
- `src/auth/auth.controller.ts`
- `src/openapi/api-docs.ts`
- `test/authentication-availability.http.spec.ts`
- `test/profile-picker.http.spec.ts`
- `test/self-profile.spec.ts`
- `test/admin-department.openapi.spec.ts`
- `README.md`
- `Docs/authentication-availability-contracts.md`
