# Remaining backend contracts — 19 October 2026

## Later approvals supersede the pending entries below

The user subsequently approved shared-task content/history, shared personal
web/Telegram preferences, owner-granted group admission and durable invitation
cards. These are implemented and locally verified; see
[shared content](shared-task-content-contracts.md),
[preferences](personal-model-preferences-contracts.md),
[group admission](group-admission-contracts.md) and the1,382-test checkpoint in
`group-admission-verification-20261019.json`. Group history policy is recorded at
admission; general group messages/topics/history retrieval remains unfinished.

The16:54 approval also selected retained session intent identity, durable dispatch
and long-lived authorized history. That batch is locally verified; see
[its implemented contract](session-intent-history-contracts.md) and
`session-intent-history-verification-20261019.json`. Detailed tool
text retrieval remains at strict metadata pending the specific disclosure choice.
No initial intent TTL, per-task rerun lock, automatic training/export or production
provisioning was approved. Persistent agents were explicitly deferred at16:47.

The direct later approval of Postman updates on this local thread supersedes the
historical hold below. The profile description update succeeded and passed readback;
the remaining cloud refresh is partial and blocked by a subsequent automatic
approval rejection of the specific internal API payload/destination disclosure.
No more writes are attempted. No application requests are executed.

The rest of this document preserves the earlier assessment as historical context,
not the current approval ledger. Parent retains checklist acceptance.

This follow-up reviewed the current account, project/task, group and agent source
on dev at base `b6b55e3826d3e8a2a3c6009845879a859cdfe88d`, including the preserved
local reliability changes. It selects no new access, credential, retention or
storage policy. Historical reports remain useful context; current source and the
later linked-agent decisions supersede their older missing-feature statements.

## Safe work completed

The first reliability batch verified six content reads and Telegram confirmation
against current persisted authority. The follow-up reproduced three more
post-authentication content failures returning500: project detail, creator-only
group metadata, and creator-only group creation readback. The corrected reads use
the same narrow Prisma availability classifier and sanitized
`READ_DEPENDENCY_UNAVAILABLE` response. Successful projections and admission rules
are unchanged. No write, group membership, invitation, message, agent or permission
is created by a read failure or retry.

The three new failures and two missing OpenAPI descriptions failed before the
correction (5 failed / 45 passed). After correction the focused read/group/helper
run passes75 tests in3 suites. The full regression passes1,336 tests in74 suites;
lint, TypeScript, formatting, build and release checks pass. The metadata-only
export verifies175 operations from28 controllers, including all nine covered read
availability contracts. The first fixture-start attempt failed before any
application reproduction; it is recorded separately and is not counted as defect
evidence. The confirmed reproduction used the explicit isolated127.0.0.1:55439
profile_test database. Exact files, hashes, logs and limits are in
[follow-up evidence](metadata-read-verification-20261019.json).

## Specific next boundaries

| Area                           | Current source and usable behavior                                                                                                                                                                                                                                          | Boundary before another feature batch                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and profile           | `accounts.controller.ts`, profile-save/privacy/avatar/manual-status controllers expose the existing self, staged Save, viewer projection, Contacts and shared-status contracts. `telegram-link.dto.ts` deliberately returns only stored NOT_LINKED/LINKED/INCOMPLETE state. | Username/phone editing and its authentication/revocation effects remain unselected. Stored link state proves neither Telegram reachability nor recovery eligibility. Link replacement/recovery and password/OTP timing contracts require their own selected lifecycle. No additional edit permission is inferred.                                                                                                             |
| Personal model preferences     | Telegram's model panel has validated draft/confirm and now serializes current authority with save. Project and session choices remain separate selectors.                                                                                                                   | Shared REST/web access to personal provider/model/effort settings is one of the three pending choices. Do not add it merely because Telegram persistence exists.                                                                                                                                                                                                                                                              |
| Project/task content           | `projects.service.ts` retains member/read-all versus public-read redaction. Human tasks have separate current-membership reads and bounded query contracts. `shared-tasks.dto.ts` exposes sharing state, revision and canonical completion.                                 | Full destination-board task fields/checklists/comment/audit visibility is pending. Existing share/unshare/move/completion operations do not authorize additional disclosure, bidirectional content edits, deletion propagation or reopening.                                                                                                                                                                                  |
| Initial coding session retries | Existing durable turns/events, project/task creation receipts and session readback remain available.                                                                                                                                                                        | Initial session creation receipts require the pending retention/retired-key versus expiring-intent choice. Existing turn receipts are not permission to choose initial-session retention.                                                                                                                                                                                                                                     |
| Human conversations            | `groups.controller.ts` / `groups.service.ts` implement metadata creation and creator-only metadata/receipt reads. An OPEN human needs no extra create grant. Creator identity remains authoritative across workspaces.                                                      | Durable human DMs, participant admission, invitation components/delivery, topics, messages and read state are absent. Owner/trusted-admin appointment and invitation delegation, who selects admission history, rejoin effects and changes to existing history access are unresolved. Approved None/100/300/All and per-topic counting alone do not define these authority transitions.                                       |
| Persistent agents              | `auth.types.ts` / `auth.guards.ts` authenticate OPEN human Users. `delegated-bio.foundation.ts` models the later owner-linked assistant, downward grant loss, exact replacement approval and attribution rules, with no registered production adapter.                      | Trusted persistent agent/link identity and independently revocable authentication, atomic approval/revision/receipt persistence, all human bio writers, and all effective owner-grant writers must participate before activation. Persistent scope, transfer/revocation effects and runtime provisioning remain explicit contracts. A human JWT, session/thread ID, body agentId or feature flag is not agent authentication. |
| Deployment                     | Existing local browser-session, avatar and provider boundaries remain documented.                                                                                                                                                                                           | Production TLS/origin/key rotation/retention, private avatar storage and coordinated migration/writer rollout are operational verification, not local API completion. No production claim follows from local tests.                                                                                                                                                                                                           |

The conversation and agent boundaries are grounded in
[conversation decisions](conversation-foundation-decisions.md), the later
[linked-assistant decisions](linked-agent-delegation-assessment.md), and
[inactive bio foundation requirements](delegated-bio-foundation-contracts.md).
The older general agent gap report must not erase those later approved linked-agent
rules. The three current product questions remain pending; this inventory opens
no new questionnaire and adopts none of the proposals as defaults.

No further independent feature is claimed ready merely because its DTO can be
written. Existing legacy unpaginated lists and capped history remain documented
compatibility limitations; adding speculative filters or frozen pagination is
not part of this reliability correction. Parent retains checklist acceptance.

## Handoff

Frontend consumers can use the existing projections and handle recognized database
outages as unavailable data: keep the authenticated context and draft, then permit
a deliberate GET retry. This does not authorize automatic mutation replay.
The group read retains its existing transaction-semantic error mapping; this
patch only adds recognized connection/pool/configuration availability handling.
Postman writes/retries and further approval requests are held. Local documentation
is the handoff. No new migration, dependencies, live settings or external service
calls were added.
