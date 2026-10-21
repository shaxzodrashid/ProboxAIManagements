# Local session intent, dispatch and retained history

The 19 October user approvals authorize local implementation. Deployment, secret
provisioning and production migrations remain separate. Agents are deferred.

## Intent and acceptance

`POST /sessions/creations` accepts the existing create fields plus a required UUIDv4
`requestId`. Persist that ID before sending. Transport retries retain the original
ID; an intentional Run again uses a new ID immediately, even for identical input.
There is no per-task rerun lock or thirty-day deduplication window.

The authenticated creator and intent uniquely identify the retained run. The
allowlisted original semantic command is fingerprinted before resolving mutable
catalog/preferences/directory state. Matching retries return the original minimal
receipt `{accepted:true, requestId, sessionId, initialTurnId, acceptedAt}`; changed
input with the same ID returns409. Current OPEN account, workspace, assigned manager
and sessions.create remain mandatory. No role-label shortcut restores access.
Optional null values are rejected rather than silently equated with omission.

`GET /sessions/creations/:requestId` reconciles the same receipt under current
authority. A404 is not proof that a concurrent acceptance failed. On timeout/503,
keep the ID and reconcile or retry it; never silently invent a replacement.
The legacy `POST /sessions` remains available without an initial retry guarantee.
Telegram's internal queued session without an initial turn remains distinct.

Acceptance atomically commits run, encrypted initial input, pending initial turn,
task state and durable events. Existing retained session rows hold intent identity;
there is no speculative independent outbox or external queue infrastructure.

## Dispatch and crash boundaries

Startup and the existing ten-second recovery poll claim committed pending initial
turns under ordered Workspace, Task and Session row locks. A post-commit callback
only reduces latency. Different workers cannot claim the same current generation.
Current actor, workspace, permissions, task assignment and directory are rechecked
before launch and by the existing beforeSpawn fence.

Expired ownership is automatically reclaimed only for a keyed initial turn that
remains QUEUED, has never recorded executionStartedAt and has NOT_STARTED status.
Once the external-start boundary has been recorded, recovery interrupts with
STOP_UNCONFIRMED and does not replay. This is not exactly-once external execution:
a crash after the durable start marker but before actual spawn is ambiguous too.
Retrying the intent still returns the same run. A deliberate new intent is a
separate action. Existing simultaneous-run policy is unchanged.

## Inputs and retained content

Keyed creation requires independently provisioned `SESSION_INPUT_KEYS` and active
`SESSION_INPUT_KEY_ID`. Each key is32 bytes, canonical base64url. AES-256-GCM binds
the protected executable input to its session and turn; the runner receives exact
plaintext only in memory. Missing, corrupt or unavailable keys fail before external
start. Keep old key IDs during rotation for retained input decryptability. No
production key was created. Never reuse JWT/BFF/provider secrets.

New protected turns retain a separate best-effort redacted prompt for history.
Legacy plaintext inputs remain compatible; this migration does not rewrite old
prompts or old raw filesystem archives. Any legacy encryption/redaction backfill
requires an operator-controlled rollout and backup/deletion review. Unconfigured
legacy writes retain their pre-existing execution-input storage behavior.

Known visible runner events retain sanitized detail in the same durable event
transaction, alongside the existing bounded live projection. Unknown/internal
items, hidden reasoning and internal prompts are omitted. Redaction handles known
configured secrets and common credential forms; it cannot guarantee recognition
of arbitrary sensitive text. Stderr is assembled across transport chunks, suppresses
private-key blocks and omits lines exceeding64KiB. New keyed runs use database
archives, avoiding duplicate raw filesystem archives. New legacy archive files are
sanitized; existing files are untouched. Final diff capture is restricted to the
execution directory subtree and retains the existing64MiB capture bound.

`GET /sessions/:id/archive` uses current sessions.read, assigned-manager and
workspace checks on every request. It uses the existing event high-water cursor
contract, default1 event/max5 detailed events per page. The ordinary live/history
queries select only bounded public columns. Detail pages fetch retained payloads
only for that page. Stored canonical hashes survive JSONB key reordering; responses
also identify their current re-redacted projection hash and policy version.

**Tool command/output, diff and stderr retrieval remains STRICT_METADATA pending
the specific user disclosure choice.** Rich sanitized data can be retained without
making it available through this projection. Visible assistant responses retain
full available text separately from live truncation. Legacy omissions are explicit.

`GET /sessions/:id/turns` returns50 chronological turns per page with an opaque
startedAt/id cursor scoped to actor/workspace/session and a captured high-water
time. The cursor grants no authority. Ciphertext is never part of a response.
Reported usage identifies its event, provider/model and observed time. Unknown
normalized costs remain null; no pricing is guessed. Runtime provenance records
actual application/Node/schema versions when available and labels optional
operator-reported commit; unavailable runner versions remain null.

Content is retained until authorized deletion, with no automatic thirty-day
cleanup. Existing task/session deletion cascades remove associated database
history. This does not create a general deletion UI or erase pre-existing backup
copies/files. No automatic research export, training, paid execution, external
analytics or live infrastructure provisioning is included. Operators must plan
database/backups/disk growth and key retention for months of detailed history;
pagination bounds responses, not total retained storage.
