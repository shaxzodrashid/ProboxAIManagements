# Backend feature availability

Generated from package.json and backend-release-catalog.json. Run `pnpm release:docs` to update; `pnpm release:check` verifies consistency.

Current package release: **0.3.0-dev.6**. Dev prereleases are progress snapshots, not production deployments. URL compatibility remains **/api/v1**.

Baseline package snapshot: 0.1.0 at commit `31fdd5a9d9a9bf19d6268c24504496bb54b75e2a`. Observed package snapshot only. Legacy feature introduction versions and release/deployment history are unknown.

Available since refers to the first tracked Git release containing this bounded backend contract. A foundation does not close its larger checklist feature. Each release tag resolves to the actual implementation commit; no historical introduction version is inferred.

| Feature / bounded contract                                         | Available since | Scope      | Evidence                                                       |
| ------------------------------------------------------------------ | --------------- | ---------- | -------------------------------------------------------------- |
| Self-scoped identity and independent names                         | 0.2.0-dev.1     | supported  | [Contract](../Docs/self-profile-contract.md)                   |
| Atomic account lifecycle and role changes                          | 0.2.0-dev.1     | supported  | [Contract](../Docs/admin-atomicity-contracts.md)               |
| Credential rejection versus authentication availability            | 0.2.0-dev.1     | supported  | [Contract](../Docs/authentication-availability-contracts.md)   |
| Active-human group metadata and creator-only retry/readback        | 0.2.0-dev.1     | foundation | [Contract](../Docs/chat-group-metadata-contracts.md)           |
| Department/template response, validation and concurrency contracts | 0.2.0-dev.1     | supported  | [Contract](../Docs/template-department-contract-fixes.md)      |
| Systemd deployment CLI and sandbox lifecycle verification          | 0.2.0-dev.2     | foundation | [Contract](../Docs/deployment-cli.md)                          |
| Deletion identity/readback and recoverable local boundaries        | 0.2.0-dev.1     | foundation | [Contract](../Docs/file-deletion-journal-contracts.md)         |
| Public identity on fresh human task reads                          | 0.3.0-dev.3     | supported  | [Contract](../Docs/task-assignee-identity-contracts.md)        |
| Human task edits preserve existing creation text limits            | 0.3.0-dev.6     | supported  | [Contract](../Docs/task-text-limit-contracts.md)               |
| Current workflow label and palette on member task reads            | 0.3.0-dev.2     | supported  | [Contract](../Docs/task-workflow-display-contracts.md)         |
| Bounded initialization event recovery                              | 0.2.0-dev.1     | supported  | [Contract](../Docs/initialization-event-readback-contracts.md) |
| Profile audiences, directed contacts and private aliases           | 0.2.0-dev.1     | supported  | [Contract](../Docs/profile-picker-contracts.md)                |
| Optional plain bio, limit1000 and private default                  | 0.2.0-dev.1     | supported  | [Contract](../Docs/human-task-query-bio-evidence.md)           |
| Self birthday and independently authorized date parts              | 0.2.0-dev.1     | foundation | [Contract](../Docs/profile-privacy-foundations.md)             |
| Archive retention and member-only human task reads                 | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-archive-human-task-contracts.md)    |
| Durable project creation outcome and retry readback                | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-creation-readback-contracts.md)     |
| Setup enqueue failure reconciliation                               | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-enqueue-recovery-contracts.md)      |
| Permitted active-workspace project member discovery                | 0.2.0-dev.1     | supported  | [Contract](../Docs/project-member-picker-contracts.md)         |
| Task identity in project session queries                           | 0.3.0-dev.4     | supported  | [Contract](../Docs/project-session-task-identity-contracts.md) |
| Member-scoped session index for explicit project-board tasks       | 0.3.0-dev.1     | supported  | [Contract](../Docs/project-session-query-contracts.md)         |
| Stored self Telegram link readback                                 | 0.2.0-dev.1     | supported  | [Contract](../Docs/self-telegram-link-contracts.md)            |
| Bounded assigned session index                                     | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-index-contracts.md)                 |
| Canonical assistant text reconstruction                            | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-assistant-text-contracts.md)        |
| Durable turn acceptance, replay and terminal state                 | 0.2.0-dev.1     | foundation | [Contract](../Docs/session-durability-contracts.md)            |
| Authorized saved project/directory execution context               | 0.2.0-dev.1     | supported  | [Contract](../Docs/session-directory-context-contracts.md)     |
| Revision-safe project workflow statuses                            | 0.2.0-dev.1     | supported  | [Contract](../Docs/task-board-status-contracts.md)             |
| Independent checklist deadlines and whole-list ordering            | 0.2.0-dev.1     | supported  | [Contract](../Docs/checklist-order-contracts.md)               |
| Opt-in task creation retry and readback                            | 0.3.0-dev.5     | supported  | [Contract](../Docs/task-creation-recovery-contracts.md)        |
| Priority, deadlines and bounded human task queries                 | 0.2.0-dev.1     | supported  | [Contract](../Docs/exact-deadline-sort-contracts.md)           |
| Human task edits, assignees, checklists, comments and moves        | 0.2.0-dev.1     | foundation | [Contract](../Docs/human-task-collaboration-contracts.md)      |

## Release references

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
