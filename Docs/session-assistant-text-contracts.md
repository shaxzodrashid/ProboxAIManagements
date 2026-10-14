# SESSION09 assistant text reconstruction

Local implementation, 12 October 2026. This batch covers assistant text only. Public reasoning summaries remain conditional and unimplemented; hidden reasoning remains excluded. No migration or new endpoint.

## Verified provider boundary

The installed `C:/Users/user/AppData/Roaming/npm/node_modules/@openai/codex/package.json` reports CLI 0.162.1. ProboxAI launches `exec --json`; `bin/proboxai.mjs` forwards it to Codex. The matching [rust-v0.162.1 JSON processor](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/exec/src/event_processor_with_jsonl_output.rs) maps an entire AgentMessage text into `item.completed`, allocating an item ID. It suppresses agent-message starts and does not emit agent-message deltas or updates. [Matching event definitions](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/exec/src/exec_events.rs) carry whole ThreadItem objects. This is completed-message delivery, not token streaming. Model-provider configuration does not change this CLI adapter contract. An alternate PROBOXAI_BIN/PROBOXAI_CODEX_BIN or future incompatible adapter must be verified separately; it must not put deltas in completed text. No live provider call or provider spending was used to establish this contract.

## Shared REST/SSE contract

Existing `GET /api/v1/sessions/:id/events` and `GET /api/v1/sessions/:id/events/stream` use the same persisted `eventResponse`. Assistant `item.completed` payloads are newly persisted with projectionVersion 2. SERVER state/interruption and neutral/tool projections retain version 1.

Assistant payload retains `item:{id,type:agent_message,text}` and `truncated`, and adds:

```text
textUpdate: {
  version: 1,
  mode: SNAPSHOT | UNVERIFIED_FRAME,
  identity: {sessionId, turnId:null|UUID, itemId:null|string, eventId:null|UUID},
  revision: session sequence,
  phase: ITEM_COMPLETED | PROVISIONAL,
  continuation: ITEM_COMPLETE | TRUNCATED | UNKNOWN,
  runCompletion: USE_SERVER_STATE
}
```

SNAPSHOT replaces the complete display frame for `(sessionId,turnId,itemId)`. Never append its text. Duplicate or older revisions cannot replace a newer frame. Reused item IDs in another turn are separate messages. Missing/unsafe item IDs or missing turn IDs use a distinct event-ID namespace; null identities are never merged. No original private identifier is exposed through the fallback.

New assistant starts/updates, delta events and unsupported events are bounded `runner.omitted` with UNSUPPORTED_EVENT and no fragment/raw details. The verified adapter provides no token-level partial snapshots. Do not fabricate a partial answer from Working or elapsed time.

Historical raw/version-1 assistant started/updated/completed frames retain bounded text with UNVERIFIED_FRAME, PROVISIONAL and UNKNOWN (or TRUNCATED). They are display-frame replacements, not verified reconstructed provider text; no new readback upgrades them to known-complete snapshots. Legacy attribution is retained. Absence of a completed text event means assistant output is unavailable, even if the run's state is terminal; do not invent empty successful output.

ITEM_COMPLETED is completion of this message item, not success/completion of the run or proof that this was the final assistant message. Read authoritative SERVER state or the fresh session snapshot separately. Truncated text remains explicitly incomplete; no continuation download or unbounded text is promised. Secret replacement and the 16,384-JavaScript-character cap remain enforced, including readback. Persisted truncation markers survive re-projection. This remains best-effort exact secret redaction, not a guarantee that assistant prose contains no sensitive information.

## Reconstruction and gaps

`src/sessions/assistant-text-reconstruction.ts` exports a reference consumer for already-authorized envelopes. It replaces display frames, retains the latest revision per identity, ignores foreign sessions and tracks a contiguous `after` cursor independently of newest message revision. The messages accessor presents identities in earliest observed sequence order, including when an older frame arrives after a newer replacement; arrival order cannot reorder the reconstructed conversation once replay converges. Keep its instance through reconnect or replay from zero to rebuild all messages. Consumers must check needsReplay before presenting reconstruction as complete. An out-of-order gap requests REST replay after the contiguous cursor; later missing frames clear the gap without reverting newer text. More than 100 unresolved out-of-order sequences requires a fresh rebuild; it does not silently advance the cursor. The helper is not an authorization layer and does not determine run completion. A transport gap does not establish provider-side loss.

Existing server sequence holes remain 409 SESSION_HISTORY_UNAVAILABLE, never an empty successful page; clients must show unavailable history and reconcile session state. REST pagination retains the fixed high-water boundary; SSE resumes after the processed cursor. All sequences, including neutral omitted events, count toward continuity. Lost updates cannot cause duplicate concatenated text because each verified message is a self-contained snapshot.

Current OPEN/workspace, assigned-manager and sessions.read checks remain unchanged. SSE rechecks current grants each batch and closes at token expiry. This contract adds no account, project/file or tool-detail disclosure.

## Verification and changed files

Tests cover snapshot replacement, duplicate/older/reordered frames, repeated item IDs across turns, null identity fallbacks, historical partial/completed frames, truncation, bounded unknown events, reconnect and REST/SSE parity, missing-sequence replay/rebuild, and completed-item text in a failed run. Existing history-hole, revocation, workspace/manager and token-expiry regressions remain applicable. Final cumulative verification: **480 tests / 43 suites passed**, plus final focused reconstruction/projection **21 tests / 2 suites**. TypeScript, ESLint, Prettier, Nest build and git diff checks passed. Independent review's conversation-order finding was corrected with first-sequence presentation and a multi-identity regression; final review has no outstanding actionable findings. An intermediate run failed after the isolated PostgreSQL instance had a WAL write PANIC and entered recovery; that run was not counted as passing. Health checks confirmed localhost:55439/profile_test was out of recovery after the laptop reconnect notification, and the entire final suite reran successfully with exit 0. Only this isolated database was used and it was stopped after verification; no migration, deployment, commit or push.

Batch files: src/sessions/safe-session-event.ts; durable-session-events.ts; assistant-text-reconstruction.ts; dto.ts; test/assistant-text-reconstruction.spec.ts; session-deletion.http.spec.ts; this report; Docs/session-ui-event-catalogue.md; README.md. All prior cumulative work remains unstaged and preserved. Parent owns Space status; this closes the selected assistant-text semantics portion, not the conditional public-summary portion or a future token-streaming adapter.
