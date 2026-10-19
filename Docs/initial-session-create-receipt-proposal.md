# Proposed initial session-create request receipts

**Review draft only — not approved or implemented.** This is independent of the
browser-session/BFF proposal. No new route, DTO, migration, retention job, credential
or launch behavior is added here. Current `POST /sessions` still has no requestId
contract and must not be automatically retried after an unknown initial outcome.

## Existing source and intended narrow guarantee

`CreateSessionDto` requires taskId/prompt/sandbox and optional project/directory/
model selection. `SessionsService.create` validates current execution authority,
commits session/initial turn/task state/events, then schedules existing launch.
The deletion/durability contract explicitly excludes initial request-ID idempotency.
Follow-up request receipts already exist, but do not cover initial creation.

Proposed guarantee: one retained keyed logical create command registers at most
one session and initial turn. Identical authorized retries return its historical
acceptance; they never schedule another launch. This does not promise exactly-once
provider execution, eventual execution after a crash, automatic queue recovery or
prompt replay. Existing manager, workspace, project, directory and run-claim rules
remain authoritative. No new task-free session or permission key.

## Proposed additive public contract

| Route                                                | Draft behavior                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `POST /api/v1/sessions` without requestId   | Preserve legacy accepted input/response and current non-idempotent semantics. Do not retrofit a generated private key as client reconciliation.                                                                                                                                                                                                         |
| Same route with optional UUIDv4 requestId            | Strict validated keyed command.201 minimal receipt `{requestId,sessionId,initialTurnId,acceptedAt,receiptExpiresAt}`. Same original command/key returns the same receipt, never current content or a new launch. Different original command with retained key409. Explicit OpenAPI response distinction from the legacy full session/initialTurn shape. |
| Proposed `GET /api/v1/sessions/creations/:requestId` | No query selectors; current caller/workspace-derived authority.200 same minimal frozen receipt; unknown/unavailable404; expired authorized receipt410; auth/grant401/403; dependency503.404 is not proof an in-flight original rolled back.                                                                                                             |

No prompt, cwd, token, catalog snapshot, private actor history or operation result
content enters the receipt. Read current session/turn state through existing reads
and their sessions.read/manager checks. Receipt acceptance is not RUNNING, completion
or proof the child process was spawned. No automatic path from receipt GET to launch.

## Read/retry authority and command identity

Recommended read/replay scope: current OPEN authenticated caller, same saved
workspace, sessions.create, current manager relationship to the task, and current
access to the saved original project when one was selected. No sessions.read grant
is required merely to recover the minimal acknowledgment, matching the create-only
task/project receipt pattern. Actual session content remains separately gated.
Other callers/workspaces and missing resource relationships fail closed. An
archived/unrunnable resource must never be restarted by receipt replay; minimal
historical-read versus archival-disclosure treatment requires owner confirmation.

Do not rerun directory preflight/catalog resolution or mutate task state on a
matching receipt branch. Fresh authorization still runs. Current filesystem loss
must not be mistaken for proof that the original creation failed. If the resource
is removed, an authorized retained key returns an unavailable/removed outcome,
never a replacement session. Unknown and unauthorized keys must not disclose
whether another user's command exists.

Namespace: original workspace + caller + `sessions.create.v1` + request UUID,
separate from follow-ups, task/project creation and profile receipts. Fingerprint
the original validated command: exact prompt/whitespace, task/project, sandbox,
explicit directory and requested provider/model/effort, preserving documented
omitted/null distinctions. Use a versioned keyed digest and managed key ID; no extra
plaintext prompt copy or public hash. Default resolution is frozen on first
admission; a later catalog change must not turn identical replay into a new command.
Digest-key rotation must retain verification support for live fences; missing key
material fails503 rather than admitting the request anew. Values are not provisioned.

## Atomic registration and failure behavior

1. Validate DTO/request UUID and current identity; serialize the composite key
   transactionally and enforce a database unique constraint. Never rely on an
   in-memory map or browser button lock across replicas.
2. If a record exists, check current receipt authority and original-command digest.
   Return the stored receipt,409 changed reuse or410 expired/retired state. Do not
   schedule launch, rebuild an initial turn or evaluate new defaults.
3. Otherwise perform existing current execution validation and register the session,
   initial turn, task/event changes and minimal request record in one transaction.
   No child starts before commit. Failure rolls back all these rows.
4. Only the original confirmed registration path may schedule the existing accepted
   turn. Existing durable run ownership/claim prevents duplicate launch; receipt
   retries never enter scheduling. Do not add automatic prompt replay as recovery.
5. Unknown commit/transport outcome returns503/unknown guidance. Retain the exact
   command/key and use receipt lookup or identical explicit retry. A premature404
   can race the original transaction. Never allocate a new key automatically.

Crash after commit but before scheduling may leave a recorded run without observed
execution, under existing recovery semantics. The receipt exposes the IDs to inspect;
it does not silently repair execution. Concurrent different keys retain existing
task/run rules; this feature does not introduce a new task-wide concurrency policy.

## Bounded retention choices requiring approval

Recommended simple first contract:

- Keep the minimal full acknowledgment for **30 days from database acceptance**,
  non-sliding. Do not retain duplicate prompt/body content. Receipt reads/retries
  do not extend this period.
- After that, return410 to authorized callers and keep a small retired-key fence
  containing namespace/digest/IDs until the **referenced task is physically purged**.
  Keep that fence even if the session is removed earlier. A retained key never
  becomes an invitation to start another run.
- Task purge can remove the fence because the unchanged original command references
  a task ID that no longer exists and must fail normal admission. Do not support
  recreating/reusing deleted task IDs. Namespace reuse with changed task input after
  final purge is outside the retired operation's contract, not historical replay.
- No expiry/cleanup path schedules work. Do not prune an unresolved execution fence
  merely because a timer elapsed; retain it with the task and surface unknown state.

This is a30-day response window plus **lifecycle-bounded metadata**, not a fixed
30-day bound on every byte. A long-retained task retains its small fence; owners
must explicitly accept that volume/privacy tradeoff and any per-workspace budget.
No indefinite raw prompt or frozen session snapshot is proposed.

Alternative for a strict fixed total lifetime: require an expiring server-signed
creation-intent ticket before admission. After the record is pruned, an expired
ticket must still be rejected without a new run. That adds a separate pre-admission
protocol and client state, so it needs its own review. **Do not simply delete a UUID
receipt on a timer and then treat the old UUID as a fresh creation.** The owner must
choose lifecycle fences or the signed-expiry protocol before implementation.

Also confirm receipt duration, archival/removed-resource disclosure, digest-key
ownership, legacy-response compatibility and error-code vocabulary. The suggested
keyed minimal response is a new opt-in shape; existing clients must retain the old
unkeyed contract. No existing caller is assumed to send requestId already.

## Proposed migration, rollout and acceptance sequence

After approval: additive empty receipt table/constraints first; no backfill or
rewrite of historical runs. Add keyed admission/readback while preserving legacy
paths; update DTO/OpenAPI with explicit response shapes and unknown-outcome rules.
Then have the UI/BFF retain one request key and command until reconciled. The BFF
passes the key/body unchanged and does not retry generic writes automatically.
Mixed old/new writers cannot provide keyed guarantees before their handlers are
upgraded. A rollback to a binary that rejects requestId must disable new keyed UI
submission; keep receipt/fence data and never fall back to unkeyed automatic retry.

Required tests: same-key cross-process race registers one session/turn/receipt;
response lost after actual commit; uncertain commit; transaction rollback; crash
before launch; identical receipt replay does not schedule; changed prompt/model/
directory/omitted fields409; defaults/catalog change; foreign/caller/relocated or
revoked-grant denial; manager/project access loss; no read-all/admin bypass;
expired receipt410 with no new run; session removal with retained task fence; task
purge rejects original task ID; cleanup never launches; digest-key unavailability;
legacy request/response unchanged; no fake request identity on historical runs.
Controlled runner must prove launch at most once without a paid provider call.

No implementation or migration verification is claimed for this draft. Existing
backend1195-test evidence covers the current application only. Related:
[browser-session proposal](browser-session-bff-proposal.md),
[readiness plan](ui-session-readiness-plan.md),
[existing session durability](session-durability-contracts.md).
