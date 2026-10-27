# Backend feature availability

Generated from package.json and backend-release-catalog.json. Run `pnpm release:docs` to update; `pnpm release:check` verifies consistency.

Current package release: **0.3.5**. Dev prereleases are progress snapshots, not production deployments. URL compatibility remains **/api/v1**.

Baseline package snapshot: 0.1.0 at commit `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. Observed package snapshot only. Legacy feature introduction versions and release/deployment history are unknown.

Available since refers to the first tracked Git release containing this bounded backend contract. A foundation does not close its larger checklist feature. Each release tag resolves to the actual implementation commit; no historical introduction version is inferred.

| Feature / bounded contract                                                            | Available since | Scope      | Evidence                                                       |
| ------------------------------------------------------------------------------------- | --------------- | ---------- | -------------------------------------------------------------- |
| Atomic account lifecycle and role changes                                             | 0.2.0-dev.1     | supported  | [Contract](../Docs/admin-atomicity-contracts.md)               |
| Canonical article publication                                                         | 0.3.0           | foundation | [Contract](../Docs/article-canonical-publication-contracts.md) |
| Article conflict ballots                                                              | 0.3.0           | foundation | [Contract](../Docs/article-conflict-ballot-contracts.md)       |
| Frozen keep-both comparison and bounded pending article coordination                  | 0.3.3           | foundation | [Contract](../Docs/article-keep-both-coordination.md)          |
| Private article drafts and independent reading order                                  | 0.3.0           | foundation | [Contract](../Docs/article-private-draft-contracts.md)         |
| Article proposal foundations                                                          | 0.3.0           | foundation | [Contract](../Docs/article-proposal-foundations-contracts.md)  |
| Snapshot article publication review and electorate decisions                          | 0.3.0           | foundation | [Contract](../Docs/article-publication-review-contracts.md)    |
| Article reviewer resolution                                                           | 0.3.0           | foundation | [Contract](../Docs/article-reviewer-resolution-contracts.md)   |
| Atomic human Profile Save with stale-draft protection and whole-operation receipts    | 0.3.0-dev.9     | supported  | [Contract](../Docs/atomic-profile-save-contracts.md)           |
| Credential rejection versus authentication availability                               | 0.2.0-dev.1     | supported  | [Contract](../Docs/authentication-availability-contracts.md)   |
| Browser registration, recovery and keyed project creation transport                   | 0.3.3           | foundation | [Contract](../Docs/browser-auth-creation-transport.md)         |
| Unified task board queries, card placement, invalidation streams and assignee avatars | 0.3.5           | foundation | [Contract](../Docs/frontend/tasks.md)                          |
| Browser cookie sessions with CSRF and bounded proxy admission                         | 0.3.0           | foundation | [Contract](../Docs/browser-session-local-implementation.md)    |
| Active-human group metadata and creator-only retry/readback                           | 0.2.0-dev.1     | foundation | [Contract](../Docs/chat-group-metadata-contracts.md)           |
| Independent checklist deadlines and whole-list ordering                               | 0.2.0-dev.1     | supported  | [Contract](../Docs/checklist-order-contracts.md)               |
| Inactive domain rules for owner-approved delegated bio edits                          | 0.3.0-dev.7     | foundation | [Contract](../Docs/delegated-bio-foundation-contracts.md)      |
| Systemd deployment CLI and sandbox lifecycle verification                             | 0.2.0-dev.2     | foundation | [Contract](../Docs/deployment-cli.md)                          |
| Priority, deadlines and bounded human task queries                                    | 0.2.0-dev.1     | supported  | [Contract](../Docs/exact-deadline-sort-contracts.md)           |
| Deletion identity/readback and recoverable local boundaries                           | 0.2.0-dev.1     | foundation | [Contract](../Docs/file-deletion-journal-contracts.md)         |
| Durable file Trash restore and expiry coordination                                    | 0.3.0           | foundation | [Contract](../Docs/file-trash-recovery-contracts.md)           |
| Explicit group admissions and current membership authority                            | 0.3.0           | foundation | [Contract](../Docs/group-admission-contracts.md)               |
| Frozen group history visibility boundaries                                            | 0.3.0           | foundation | [Contract](../Docs/group-message-history-contracts.md)         |
| Own visible group message reactions                                                   | 0.3.0           | foundation | [Contract](../Docs/group-message-reactions-contracts.md)       |
| Admitted human group text with keyed retry recovery                                   | 0.3.0           | foundation | [Contract](../Docs/group-text-sending-contracts.md)            |
| Human task edits, assignees, checklists, comments and moves                           | 0.2.0-dev.1     | foundation | [Contract](../Docs/human-task-collaboration-contracts.md)      |
| Optional plain bio, limit1000 and private default                                     | 0.2.0-dev.1     | supported  | [Contract](../Docs/human-task-query-bio-evidence.md)           |
| Bounded initialization event recovery                                                 | 0.2.0-dev.1     | supported  | [Contract](../Docs/initialization-event-readback-contracts.md) |
| Profile audiences, directed contacts and private aliases                              | 0.2.0-dev.1     | supported  | [Contract](../Docs/profile-picker-contracts.md)                |
| Self birthday and independently authorized date parts                                 | 0.2.0-dev.1     | foundation | [Contract](../Docs/profile-privacy-foundations.md)             |
| Archive retention and member-only human task reads                                    | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-archive-human-task-contracts.md)    |
| Durable project creation outcome and retry readback                                   | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-creation-readback-contracts.md)     |
| Setup enqueue failure reconciliation                                                  | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-enqueue-recovery-contracts.md)      |
| Project list member names and audience-authorized read-all photos                     | 0.3.5           | supported  | [Contract](../Docs/frontend/projects.md)                       |
| Permitted active-workspace project member discovery                                   | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-member-picker-contracts.md)         |
| Current persisted project authority at mutation admission                             | 0.3.0           | supported  | [Contract](../Docs/project-mutation-authority-contracts.md)    |
| Member-scoped session index for explicit project-board tasks                          | 0.3.0-dev.1     | supported  | [Contract](../Docs/project-session-query-contracts.md)         |
| Task identity in project session queries                                              | 0.3.0-dev.4     | supported  | [Contract](../Docs/project-session-task-identity-contracts.md) |
| REST follow-up dispatch recovery and session read availability                        | 0.3.0           | supported  | [Contract](../Docs/rest-followup-recovery-contracts.md)        |
| Opt-in rolling browser sessions, device revocation and recent authentication          | 0.3.4           | foundation | [Contract](../Docs/rolling-authentication-contracts.md)        |
| Self-scoped identity and independent names                                            | 0.2.0-dev.1     | supported  | [Contract](../Docs/self-profile-contract.md)                   |
| Stored self Telegram link readback                                                    | 0.2.0-dev.1     | supported  | [Contract](../Docs/self-telegram-link-contracts.md)            |
| Canonical assistant text reconstruction                                               | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-assistant-text-contracts.md)        |
| Authorized saved project/directory execution context                                  | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-directory-context-contracts.md)     |
| Durable turn acceptance, replay and terminal state                                    | 0.2.0-dev.1     | foundation | [Contract](../Docs/session-durability-contracts.md)            |
| Bounded assigned session index                                                        | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-index-contracts.md)                 |
| Durable session intents, protected history and bounded retained projections           | 0.3.0           | foundation | [Contract](../Docs/session-intent-history-contracts.md)        |
| Shared checklist tree admission and validation                                        | 0.3.0           | foundation | [Contract](../Docs/shared-checklist-tree-contracts.md)         |
| Shared human task reads and revision-safe collaboration                               | 0.3.0           | foundation | [Contract](../Docs/shared-human-task-contracts.md)             |
| One shared manual availability with self revision and retry recovery                  | 0.3.0-dev.8     | supported  | [Contract](../Docs/shared-manual-status-contracts.md)          |
| Public identity on fresh human task reads                                             | 0.3.0-dev.3     | supported  | [Contract](../Docs/task-assignee-identity-contracts.md)        |
| Revision-safe project workflow statuses                                               | 0.2.0-dev.1     | supported  | [Contract](../Docs/task-board-status-contracts.md)             |
| Opt-in task creation retry and readback                                               | 0.3.0-dev.5     | supported  | [Contract](../Docs/task-creation-recovery-contracts.md)        |
| Human task edits preserve existing creation text limits                               | 0.3.0-dev.6     | supported  | [Contract](../Docs/task-text-limit-contracts.md)               |
| Current workflow label and palette on member task reads                               | 0.3.0-dev.2     | supported  | [Contract](../Docs/task-workflow-display-contracts.md)         |
| Department/template response, validation and concurrency contracts                    | 0.2.0-dev.1     | supported  | [Contract](../Docs/template-department-contract-fixes.md)      |
| Bounded native Windows directory restoration                                          | 0.3.0           | foundation | [Contract](../Docs/windows-directory-restore-contracts.md)     |

## Release references

- **0.3.5**: `refs/tags/v0.3.5`, production, not-deployed.
- **0.3.4**: `refs/tags/v0.3.4`, production, deployment-unverified.
- **0.3.3**: `refs/tags/v0.3.3`, production, deployment-unverified.
- **0.3.2**: `refs/tags/v0.3.2`, production, deployment-unverified.
- **0.3.1**: `refs/tags/v0.3.1`, production, deployment-unverified.
- **0.3.0**: `refs/tags/v0.3.0`, production, deployment-unverified.
- **0.3.0-dev.10**: `refs/tags/v0.3.0-dev.10`, dev, not-deployed.
- **0.3.0-dev.9**: `refs/tags/v0.3.0-dev.9`, dev, not-deployed.
- **0.3.0-dev.8**: `refs/tags/v0.3.0-dev.8`, dev, not-deployed.
- **0.3.0-dev.7**: `refs/tags/v0.3.0-dev.7`, dev, not-deployed.
- **0.3.0-dev.6**: `refs/tags/v0.3.0-dev.6`, dev, not-deployed.
- **0.3.0-dev.5**: `refs/tags/v0.3.0-dev.5`, dev, not-deployed.
- **0.3.0-dev.4**: `refs/tags/v0.3.0-dev.4`, dev, not-deployed.
- **0.3.0-dev.3**: `refs/tags/v0.3.0-dev.3`, dev, not-deployed.
- **0.3.0-dev.2**: `refs/tags/v0.3.0-dev.2`, dev, not-deployed.
- **0.3.0-dev.1**: `refs/tags/v0.3.0-dev.1`, dev, not-deployed.
- **0.2.3-dev.1**: `refs/tags/v0.2.3-dev.1`, dev, not-deployed.
- **0.2.2**: `refs/tags/v0.2.2`, production, deployment-unverified.
- **0.2.1**: `refs/tags/v0.2.1`, production, deployment-unverified.
- **0.2.0**: `refs/tags/v0.2.0`, production, deployment-unverified.
- **0.2.0-dev.2**: `refs/tags/v0.2.0-dev.2`, dev, not-deployed.
- **0.2.0-dev.1**: `refs/tags/v0.2.0-dev.1`, dev, not-deployed.
