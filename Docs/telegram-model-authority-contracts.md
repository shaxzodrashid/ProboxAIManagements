# Telegram model preference save authority

This corrects an existing model-panel authorization race; it does not add REST
preferences, permissions, link/recovery operations or a new model-selection policy.

## Reproduced failures

Real PostgreSQL barriers reproduced three confirmed settings writes after an
earlier authority lookup had succeeded but permission removal, account banning or
chat-identity change committed ahead of the eventual update. The original save
checked current identity/grants and compared the three saved preference values,
but the authority read and update were separate operations.

A workspace-only correction protected participating administrative writers. A
second physical barrier demonstrated that an account-identity writer without a
workspace fence could still win before the update. Existing contact registration
is one user-row writer outside that workspace protocol, so the final correction
also protects the subject User row.

A final barrier changed only the Telegram sender ID while retaining the chat ID.
That reproduced a further stale-authority write when the transactional lookup did
not include the original sender. The panel now binds its draft and confirmation to
that sender and rechecks it in the locked transaction. Reopening from a different
sender replaces the draft nonce; old buttons cannot save it.

## Final local guarantee and ordering

Confirmed save now uses one transaction and lock order:

1. Workspace row.
2. Bound subject User row, selected by original actor/workspace.
3. Re-read current Telegram identity and role permissions through that same
   transaction client, including the bound Telegram sender ID. Require the same
   actor/workspace and sessions.create.
4. Compare-and-swap the original providerId/model/reasoningEffort and update only
   those three settings. The conversation row is acquired by this final update.
5. Commit before rendering the closed Telegram panel.

Participating grant/lifecycle writers share the workspace fence. Native User-row
locking also serializes identity changes that do not use that fence. A revocation
that wins admission prevents the preference write. A save admitted first can commit
before a later revocation; no retroactive cancellation or global credential policy
is implied. All affected deployment writers still need coordinated rollout.

No Telegram network call, provider call, task/session creation or filesystem work
runs while these database locks are held. Drafts close before persistence I/O as
before. Definite changed access/base values return the existing zero-update/closed
panel outcome. Unknown transaction/save outcomes retain the existing uncertainty
message and cannot be replayed by duplicate Confirm buttons.

Project/session selectors are neither compared nor written: a newer selection is
preserved while saving the chosen model settings. Concurrent model-setting changes
still fail compare-and-swap. Existing actor/workspace/chat/message/nonce/revision/
expiry checks, per-user queues, Telegram update deduplication and model-specific
catalog validation remain in place. Legacy model/provider/effort callbacks remain
non-writing.

## Verification

The tests use real PostgreSQL, the real bot/model panel/identity service and
synthetic users/grants/conversation rows. Telegram transport and session execution
are mocked; no live message or paid provider is contacted.
Controlled SQL transactions represent the authority writers at physical lock
barriers; these tests do not invoke a live administrative service or identity provider.

- The original barrier run failed3 authority cases and passed2 positive cases.
- The workspace-only candidate passed those cases but failed the additional
  unfenced identity-writer case (1 failed/5 passed).
- Final coverage includes permission removal, lifecycle ban, participating and
  unfenced chat-identity changes, sender-only identity changes, successful confirmation preserving newer
  project/session selectors, and refusal to overwrite a concurrent model change.
- The sender-only barrier failed against the user-row-only candidate (1 failed /
  6 passed); all seven physical persistence cases now pass. A separate panel test
  checks sender binding, draft replacement and old-button refusal.
- Final focused bot/panel/edit/relay/persistence coverage: 51 tests / 5 suites pass.
- Existing bot, model-panel, edit-message and relay regressions remain applicable.
  Final focused/full results are recorded in the batch verification evidence.

Final full regression: 1,332 tests / 74 suites passed. See
[batch evidence](backend-reliability-verification-20261019.json) for reproduction
logs, source hashes and limits.

No migration, dependency, credential or deployment setting is added. REST sharing
of these preferences remains an owner selection, independently of this correction.
