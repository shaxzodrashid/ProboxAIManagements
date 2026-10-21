# Owner-granted group admission and invitation cards

Later increment: `group-message-history-contracts.md` implements bounded message
reading and durable initial-admission windows. Older missing-message/history
statements below describe the original admission slice.

Approved19 October: owner grants invitation rights; general role permissions do
not bypass them. The invitation creator selects None/last100/last300/All history
without another owner/admin approval step. DIRECT adds the account immediately;
APPROVABLE sends a structured in-app DM invitation card. This supersedes the older
mandatory recipient-acceptance rule for every admission and the proposed
owner/admin-only history selection. Agents are deferred entirely.

This first slice implements initial human admissions, owner-only invitation grants,
direct addition, recipient accept/decline and a durable participant-scoped DM card
stream. It does not add ordinary free-text DMs, group messages/topics, reactions,
member removal/rejoin, retroactive history-policy edits, owner transfer or agents.
History selection and authoritative admission time are persisted. With no group
message/topic model yet, this does not claim working retrieval of100/300 historical
messages; that future reader must enforce the approved per-topic policy.

The owner has an explicit initial invitation grant. Only the owner can change
invitation grants, only for current OPEN members. Other members cannot delegate
rights or self-elevate, including members with workspace ADMIN permissions. Every
invitation action checks the current owner-granted right. There is one invitation
right for both approved modes; no unapproved workspace permission or admin role is
created. Owner-only grant changes are revision-checked and audited atomically.

The inviter selects historyAccess on the invitation, default NONE. The value is
immutable and copied on admission; neither an owner nor an admin must approve it
again. Direct mode creates membership in the same transaction as the invitation.
Approvable mode creates a durable GROUP_INVITATION component in the sender/recipient
DM conversation, without membership until that exact recipient accepts. Its
acceptance/decline is idempotent by invitation identity. A contrary later decision
conflicts. Membership is never inferred from possessing a card or a conversation ID.

Create requestId is stable per inviter, with a semantic fingerprint including
group, recipient, mode and history. Authorized same-input replay returns the same
invitation; changed input conflicts. A second pending invitation or existing
membership conflicts instead of silently replacing history. No invitation is sent
to Telegram/email or another external service. Controlled tests create synthetic
people and records only.

Writes serialize involved account workspaces in sorted order, then group, then
subject account rows. Recheck current OPEN actors, recipient and workspace state
after locking. Owner grants and invitation acceptance share the group fence.
Acceptance also rechecks the inviter's current membership/right; revocation that
wins the fence prevents admission. Existing cards remain historical components;
restoring permission may make a still-pending card usable again. This is current
authority checking, not a new automatic invitation-cancellation policy.

Card reads include current `actions.accept` and `actions.decline` booleans; these
are snapshots, and the decision route checks again. Expired/permanently revoked
states and TTLs are not invented. See the [exact visual handoff](group-invitation-card-contract.md).

DM lists/messages are visible only to the two current authenticated participants,
including across workspaces. Cards expose only the frozen group name and invitation
fields, not group history, roster, private profiles, credentials or unrelated
conversations. Admitted accounts can discover/read their own group memberships.
There is no public roster API or general-role conversation bypass.

The additive migration preserves existing group metadata/creation receipts and
backfills only each existing owner's initial membership and invitation grant.
New groups create both atomically with their existing creation receipt. Normal
PostgreSQL schema locks and coordinated application rollout are required; no
production migration is performed by this local implementation.
