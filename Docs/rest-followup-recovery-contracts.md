# Durable REST follow-up recovery — 20 October 2026

This closes a verified gap in the already approved atomic acceptance/durable
dispatch model. It does not change invitation, preference, retention or disclosure
policy. Postman actions remain stopped. No agent, provider or live Telegram call
is involved.

## Reproduced failure

A real isolated HTTP test accepted a follow-up with202 and a persisted QUEUED
turn, suppressed the process-local launch callback, expired the owner's lease and
ran restart reconciliation. The old service marked the never-started turn
INTERRUPTED. Initial keyed creations already had durable polling; follow-ups did
not. The failing assertion is retained in the before-test log.

## Implemented behavior

New `POST /sessions/:id/turns` acceptances persist `durableDispatch=true` on the
turn, atomically with the existing request binding, session/task state and event.
This field is server-owned and excluded from public turn/receipt DTOs. The normal
post-commit launch remains unchanged. HTTP202 is acceptance, not successful work.

If that callback is lost, the current live lease is respected. Once the lease
expires, the existing startup/ten-second recovery poll can reset an opted-in turn
for dispatch only when it is still QUEUED, has no executionStartedAt, the session
has NOT_STARTED evidence and exactly one active turn exists. The same locked
dispatcher used for initial creations claims this work. Recovery waits for lease
expiry plus polling/availability; it does not promise immediate restart execution.

Workspace, Task and Session lock order and owner/lease fencing remain intact.
Separate workers cannot execute the same current claim. A second lost claim can
be reclaimed while it remains provably never started; the original worker's late
callback is fenced out. Launch repeats current OPEN account, workspace, assigned
manager, sessions.manage and directory/project checks. A grant or lifecycle loss
cannot be bypassed by the stored request ID. Interruption before launch prevents
dispatch.

After executionStartedAt or ambiguous external-start evidence, recovery retains
the existing INTERRUPTED/STOP_UNCONFIRMED behavior. It never automatically replays
that execution or enables a fresh turn past the unconfirmed-stop gate. This is
durable first execution of an accepted never-started command, not an exactly-once
external execution guarantee.

Same requestId and exact prompt still return the original turn's current receipt;
changed input conflicts. Lost commit acknowledgement can be reconciled and safely
dispatched under the original ID, without allocating another turn. No per-task
run lock, intent TTL or content cleanup is introduced.

## Compatibility and migration

`20261020010000_rest_followup_dispatch` adds a non-null boolean with default false
and an index, in one transaction. Existing turns do not opt in through backfill.
Legacy unopted pending turns retain interruption-without-execution recovery.
Existing initial-keyed creation recovery remains supported independently of this
new flag. Telegram-created turn dispatch remains unchanged and does not opt in.
The new flag does not activate old ambiguous or historical work.

The migration was applied only to the retained isolated profile_test database on
127.0.0.1:55439. PostgreSQL truncates the generated SQL index identifier; Prisma
explicitly maps the actual physical name, and schema comparison reports no drift.
The applied migration file was not subsequently edited. Production requires
normal schema-lock and coordinated migration/application rollout planning.

## Recovery reads

Four existing GET routes now apply the established narrow read-dependency
classifier after authentication: session snapshot, bounded history, retained
archive and follow-up receipt. Recognized connection/configuration/pool failures
return sanitized503 with `code=READ_DEPENDENCY_UNAVAILABLE` and respectively
`readSession`, `readSessionHistory`, `readRetainedSessionArchive` or
`readSessionTurnReceipt` as a static action. Unknown programming failures stay500;
validation, resource and permission failures keep their current status.

These reads do not retry automatically or classify mutations as rolled back.
Retain the accepted ID and authorized context while unavailable; never create a
new intent merely because reconciliation temporarily fails. OpenAPI documents
post-authentication availability separately from authentication failure.

Detailed tool text remains STRICT_METADATA. No archive contents were exposed as
a shortcut, no new endpoint or permission was added, and no authentication or
production security setting was changed.
