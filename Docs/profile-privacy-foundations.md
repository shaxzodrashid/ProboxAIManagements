# Profile privacy and birthday foundations

This batch adds owner-only management and an internal viewer-aware projection. It does not ship a public identity lookup or recipient discovery route. API10/API13 remain partial: known recipient UUID sets can be managed, but recipient selection and public profile/asset endpoints are not complete. API02 now includes self birthday storage; avatar/status writes and delivery remain pending.

## Routes

All routes require a currently OPEN account; no feature permission is required. Identity/workspace are reloaded by the authentication guard and checked again within owner transactions. Every response has Cache-Control: no-store.

- GET /users/me and PATCH /users/me include birthDate (YYYY-MM-DD or null). Omission retains it, null clears it. Calendar validation accepts years 0001–9999 including future dates, without inventing age restrictions. Admin and other-user DTOs do not expose it.
- GET /users/me/privacy returns five fields: AVATAR, BIO, STATUS, BIRTHDAY_DAY_MONTH, BIRTHDAY_YEAR. Missing records return NO_ONE and empty sets.
- PUT /users/me/privacy/:field atomically replaces mode and both complete accountIds/workspaceIds sets. All three properties are required. Modes: NO_ONE, EVERYONE, CONTACTS, CUSTOM. Non-CUSTOM requires empty sets. CUSTOM may be empty. UUIDs must identify existing OPEN accounts or existing workspaces; errors reveal no labels. Response counts are selected entries, not unique viewers.
- GET /users/me/contacts returns owner-directed accountId/createdAt entries only.
- PUT /users/me/contacts/:accountId idempotently adds a known OPEN account.
- DELETE /users/me/contacts/:accountId idempotently removes that owner's edge.

PUT /users/me/profile is the UI Save changes endpoint. It accepts allowlisted optional firstName/lastName/bio/birthDate plus required audiences (an array of complete field policy replacements). Duplicate fields are rejected; omitted profile/audience fields retain values. Profile changes, every supplied policy, and each policy's account/workspace sets commit in ONE serializable transaction. Its response contains profile and all five audiences. Existing PATCH self and per-field PUT remain individual operations; the UI must use the combined route for staged Save.

Contacts Add/Remove are separate explicit commands. Save does not modify Contacts and rejects a contacts property. Done closes the Contacts manager only, with no implicit backend mutation.

A received validation/authentication error or serialization conflict is a definite rejected operation; no part of Save is committed. A confirmed database rollback also rejects the whole transaction. A 503 from an unknown database/commit failure, transport timeout/disconnect, or intermediary failure after dispatch is an unknown outcome: it may have committed. Do not interpret every server error as proof of rollback. Reconcile GET /users/me and GET /users/me/privacy against staged values before retrying; reconcile Contacts separately with GET /users/me/contacts. Do not claim Save failed solely because its response was lost. Serializable 409 should be reread/reconciled before retry, with no automatic stale replay. No idempotency key or optimistic revision protocol is introduced in this batch.

Recipient arrays have a bounded implementation limit of 500 entries each. This is a technical batch assumption, not a product-scale commitment. No labels, directory, roster, reciprocal acceptance, notifications or blocking were introduced. Status has one grouped audience policy. Avatar/status policy records do not create data delivery capabilities.

## Reader and revocation

ProfilePrivacyService.project is internal, not registered as a production HTTP route. Its allowlist contains only bio, birthdayDayMonth {day, month}, and birthdayYear. Hidden and unset both return null. It never includes full birthDate, names, username, phone, workspace, permissions, credentials or lifecycle details.

EVERYONE includes anonymous and cross-workspace viewers. CONTACTS checks the profile owner's directed owner-to-viewer edge, never the reverse. CUSTOM unions explicit account grants with current workspace membership. Explicit account grants survive workspace changes. Missing/unknown policy fails closed, including for owners (owners use the separate self route). Missing/inactive viewer identity is anonymous and gets only EVERYONE fields. Missing/inactive owner returns the internal null projection.

Each read uses a new repeatable-read transaction; no audience cache is used. Membership/Contact removal is effective on the next read. An already-running transaction sees its consistent snapshot. Database failure produces sanitized 503, never a permissive fallback. Future public endpoints and avatar delivery must call the evaluator and enforce no-store; no public asset bypass is implemented.

Owner writes use serializable transactions and replace policy and both recipient sets together. Concurrent serialization failures return 409 with reread guidance. Unknown database errors return sanitized 503; insertion failures roll back the entire replacement.

## Migration safety

20261011010000_profile_audiences adds a nullable DATE and new enums/tables/indexes with cascading foreign keys. No names are split, no existing fields overwritten, and no policies or publication grants are backfilled. Existing accounts therefore start private even when bio/birthday exists. Migration verification is limited to the task's isolated localhost PostgreSQL database. Nothing has been applied to production.

## Validation

Pure evaluator/calendar tests and HTTP tests use real services, authentication guard and isolated PostgreSQL. A test-only projection fixture exercises HTTP redaction without shipping an unapproved public route. Coverage includes zero-permission owners, anonymous/cross-workspace viewers, owner/caller inversion, current membership changes, Contact removal, independent birthday audiences, field injection, recipient rejection, and real transaction rollback through an isolated database trigger.

## Guarded main Profile Save

New editors should use the additive coherent edit/readback/commit protocol in
[atomic Profile Save](atomic-profile-save-contracts.md). It includes optional
shared availability in the same transaction and detects stale drafts across
legacy writers. The older PUT /users/me/profile retains its original response
and unguarded-client behavior for compatibility; its writes advance the aggregate
generation. Its previous unknown-outcome limitations still apply to that older API.
