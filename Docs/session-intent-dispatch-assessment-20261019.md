# Session creation intent and dispatch — repository assessment

The user approved local implementation of intent identity, atomic acceptance and
durable dispatch on19 October at16:54 UTC, together with long-lived detailed
authorized session history. The implemented batch and controlled failure tests are
now recorded in [the final contracts](session-intent-history-contracts.md) and
`session-intent-history-verification-20261019.json`. The repository assessment
below preserves the pre-implementation analysis, not current missing-feature
claims. There is no30-day content
cleanup or per-task rerun lock. Intent identity, database acceptance and dispatch
reliability remain separate guarantees. Agents are explicitly deferred.

## Actual repository constraints

`SessionsService.create` currently locks Workspace then Task, rechecks OPEN actor,
current sessions.create, assigned-manager/workspace and selected project/directory
scope, and commits session, initial turn, task state and durable events atomically.
There is no initial client intent ID. Each accepted create allocates another
session; there is no one-run-per-task uniqueness rule. A `start=false` internal
call creates a queued session without an initial turn; it must not be confused
with an accepted initial prompt. Telegram currently uses this path then its own
turn submission protocol; REST initial-create changes must preserve that distinction.

After commit, `launchAccepted` uses process-local setImmediate. `runAcceptedTurn`
claims under the existing ordered locks, checks owner/lease and QUEUED turn, checks
launch authority/directory again, and commits RUNNING/executionStartedAt plus
STOP_UNCONFIRMED before invoking runner.start. The runner has beforeSpawn fencing.
The process can still crash between that committed claim and spawning, or after
spawning before further durable acknowledgment. A receipt does not close that gap.

Startup/ten-second `reconcileExpiredRuns` currently interrupts expired ownership.
It distinguishes safely never-started queued turns from uncertain prior execution;
it does not automatically redispatch either. Existing durable turn rows can be the
pending-work source, but the current recovery implementation is not a dispatcher.

The new approved personal preference fallback resolves only on initial acceptance
when no explicit model option is supplied. Intent replay must return the original
frozen accepted selection, even if preferences or the managed catalog later change.

## Recommended bounded design

1. The frontend creates and durably retains one UUID for the explicit run action
   before sending. Disable duplicate clicks within that pending intent and reuse
   its UUID for transport retries. An intentional new run, including identical
   input seconds later, creates a new UUID immediately. Reuse is not based on task,
   prompt equality or a30-day timer. Restored drafts must retain pending intent;
   distinct tabs do not imply the same intent unless they share that persisted ID.
2. Add an optional creation intent/fingerprint to the existing retained session
   record, with a database unique constraint on authenticated creator plus intent
   in the initial-create operation namespace. Freeze workspace and task in the
   record. Do not scope the key only to task: reusing it with another task must
   conflict rather than silently allocate another run. Preserve a documented legacy
   unkeyed route if compatibility requires it; it has no retry guarantee.
3. Normalize only semantic client input: canonical UUIDs and allowlisted fields,
   preserving prompt whitespace and distinguishing meaningful omission/null.
   Hash the original normalized command, not current resolved catalog/preferences
   or mutable filesystem state. Store the resolved selection/directory snapshot
   on the accepted run. Current authority still fences acceptance and dispatch.
4. Serialize the same actor/operation/intent before checking for a prior record,
   then accept once in the same transaction as run, initial turn and events.
   Match returns the original minimal acceptance IDs/time, without launching.
   Mismatch returns an explicit409. Recheck current actor/workspace/manager/create
   authority on replay; an old key never restores revoked access.
5. Use persisted QUEUED turns as the durable dispatch queue if practical. A
   dispatcher atomically claims never-started work with an attempt/lease fence;
   process-local setImmediate is only a latency optimization. Do not add a second
   outbox unless turn/run polling cannot express the delivery/acknowledgment state.
   Duplicate polls/deliveries must converge on one claim. Runner callbacks,
   heartbeats and finalization must match the current claim generation.
6. Never redispatch an uncertain externally started attempt automatically. Preserve
   STOP_UNCONFIRMED and trusted reconciliation. Claim-before-spawn ambiguity is
   real; local database deduplication does not establish exactly-once provider or
   filesystem side effects. A future external execution adapter would need its own
   idempotency/fencing/reconciliation contract to strengthen that guarantee.
7. Resolve unknown initial responses by the original intent and current status.
   A plain GET that sees no row can race an uncommitted acceptance. Any definitive
   absent/unaccepted resolution must acquire the same intent serialization fence;
   timeout is unknown, not proof of failure. No fallback silently creates a new ID.

Keep the intent mapping with retained run records where feasible. No arbitrary
receipt TTL, lifetime tombstone or signed intent ticket is needed to implement the
core invariant. Explicitly bound replay guarantees by record retention. Before
future run-history purging/deletion, select whether expired keys are refused or
may be reused; TTL-only pruning cannot promise indefinite deduplication. That
retention question is independent of permitting intentional reruns now.

## Required tests before claiming completion

| Failure boundary                                  | Required assertion                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Concurrent double clicks, same intent             | One committed run, one initial turn, one acceptance; duplicates never schedule another dispatch.  |
| Same input, new intent                            | Two deliberate runs accepted immediately, independent of retention duration.                      |
| Same intent, changed payload/task                 | Explicit conflict, original acceptance unchanged.                                                 |
| Lost HTTP response after commit                   | Original intent resolves the frozen acceptance; changed personal defaults cannot rewrite it.      |
| Crash before acceptance commit                    | No run/turn/receipt survives; same-intent retry can accept once.                                  |
| Crash after commit before setImmediate            | Durable pending turn remains discoverable without another create.                                 |
| Duplicate dispatch and lease races                | Exactly one current claim; stale owner/generation cannot spawn, append events or finalize.        |
| Crash after claim before spawn, or after spawn    | Conservative unknown/stop-unconfirmed handling; never silently reissue potentially executed work. |
| Reconciliation racing admission                   | Shared intent lock prevents a false definitive absence result.                                    |
| Revoked grant, reassigned task, foreign workspace | Replay and dispatch fail current authorization without disclosing another scope's receipt.        |
| Purged history/expired mapping                    | Behavior follows the separately selected retention contract; no hidden new intent.                |

Existing durability, deletion, stale-lease and controlled runner suites are useful
regressions; they are not proof of the unimplemented initial-intent protocol.
No new runtime tests are claimed for this assessment.
