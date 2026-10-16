# Profile Contact revocation correction — October 16

This bounded correction supports API02's existing biography/birthday readers and
the completed shared API13 audience dependency. API02, API03, API10 and API12 do
not acquire broader closure. Parent owns Space checklist updates.

## Reconciled source and scope

The laptop resumed on `release/0.2.2` at
`f0225b51af2dea8ceae8c32b1ffef09fedee4093`, with an existing unrelated README edit.
Existing `dev` was fast-forwarded to that already-present commit, retaining the
0.2.x deployment fixes and concurrent self-profile test-server correction. The
README edit was hash-checked unchanged and is excluded from this batch. No branch
was reset/deleted, remote ref changed, or production service contacted. No AGENTS.md
or repository skill instructions were found in the inspected source/test paths.

The current checklist and Account/Profile page still leave avatar storage, status
representation/limits/defaults and first-name requiredness unresolved. Self-only
manual availability is a pending recommendation, not an approved implementation.
Existing names, biography and birthday behavior is retained.

## Corrected contract

`DELETE /api/v1/users/me/contacts/:accountId` accepts UUIDv4 references with any
letter casing. The previous case-sensitive TEXT foreign-key comparison could
return `{removed:true}` without removing the Contact. Real HTTP/PostgreSQL tests
reproduced the resulting Contacts-only biography and birthday disclosure after
both uppercase and mixed-case requests.

Deletion now compares the referenced UUID case-insensitively within the current
authenticated owner's Contact rows. Every matching spelling owned by that caller
is revoked, including historical text variants. Its private alias is removed with
the row. Existing account identities are never renamed or merged; no precedence
between historical equivalent spellings is invented. A subsequent request remains
idempotent and returns `{removed:true}`, including for an unknown valid UUID.
The response does not reveal whether an edge existed.

Authentication still requires a persisted OPEN account and current workspace;
the owner is never selected through request input. Invalid UUIDs are rejected.
Other owners' Contacts/aliases and the target account remain intact. The existing
serializable transaction and sanitized conflict/dependency failures are retained.
Reads that begin after successful revocation re-evaluate Contacts membership;
an already-running snapshot keeps its documented transaction semantics. No cache
is introduced, and responses retain `Cache-Control: no-store`.

Only the directed Contact grant is revoked. Public names and fields independently
allowed by Everyone or Custom remain visible. No field policy, explicit custom
recipient set, workspace membership, lifecycle state, role, password or token is
modified. Add/read/alias and general account-reference casing behavior remain
separate existing contracts; this patch does not claim universal UUID normalization.

## Database safety and verification

No migration, backfill, enum/default change or production database operation is
needed. The query uses bound Prisma values with the existing owner scope; no
arbitrary SQL or global identity rewrite occurs. Historical migration/evidence
databases are preserved. Persistence verification uses only the opt-in
`127.0.0.1:55439/profile_test` isolated database with its existing URL guards.

Before the correction, all 88 existing Profile tests across five suites passed;
the two new casing/redaction regressions then failed against the old code.
Four initial post-fix regressions and the original picker/public-profile suite
passed (21 tests). A fifth regression explicitly checks that independent Everyone
and Custom disclosure survives removal while Contacts-only birth year is hidden.
Final cumulative results accompany the delivered checkpoint. Verification uses
the repository's TypeScript, ESLint, build, release metadata and actual precommit
commands, with isolated persistence enabled for the Jest suite.
