# Conversation foundation decision record — October 14

This is a source audit and decision record. The subsequent bounded metadata batch
is implemented in [group metadata contracts](chat-group-metadata-contracts.md).
Parent owns Space checklist status. Conversation membership, history, invitations,
reactions and agent participation remain unimplemented.

## Confirmed user decisions

- Group permissions, including invitations, are managed by owners and trusted
  admins. This supersedes the earlier owner-only management recommendation.
  A workspace ADMIN role is not automatically a trusted group admin.
- Any active account may create a group. No additional create-permission proposal
  is retained as an approved requirement.
- Cross-workspace group participation requires an authorized invitation and
  recipient acceptance. This is the issuer's authorized invitation plus the
  recipient's acceptance; no additional workspace-admin approval is inferred.
- Invitations are structured interactive DM components, not plain-text messages.
  Their delivery depends on the missing human DM/message foundation.
- New-member history has four selectable options: None, last 100, last 300, All.
  These supersede the earlier simple visible-history recommendation.
- Approved on October 14 (owner message `Sentinel_a0c947137f388191b0a790b629fdd93c`):
  active employee means a current OPEN account belonging to the workspace.
  New-member history defaults to None; 100/300 counts messages sent before joining,
  separately for each forum topic. All remains available. This does not choose
  rejoin behavior or retroactive changes to existing members' access.
- An account may add multiple distinct emoji to one message, at most one of each
  emoji. Removing one own emoji preserves its other emoji and all other accounts.
- Chats are platform-wide participant-authorized conversations, not public or
  project-membership feeds. Groups may have forum Topics. Project Threads are
  separately project-scoped. Human and agent participation is selected.
- Planned ProboxAI agents are persistent participants, not Codex sessions. They
  may launch coding sessions as work; sessions cannot become participants.
  Dedicated agent creation/management, group-access, permission-management and
  ownership-transfer capabilities are selected, separately from workspace role
  labels. See [persistent platform agent gaps](persistent-platform-agent-gaps.md).

## Pending details — no defaults inferred

Per-topic pre-join counting and a None default are now approved above.
No existing-member access change, retrospective expansion/restriction,
rejoin rule, invitation grant representation, trusted-admin appointment/delegation
rule or owner-transfer power is implied.
The deadline decision was subsequently resolved: explicit timed deadlines sort
first by pinned instant, then date-only by calendar date, unset last. Direction
applies within buckets; the existing type discriminator avoids a date-only sentinel.
This supersedes the pending viewer-day proposal. The active-employee clarification
is resolved above; it does not introduce an employment lifecycle separate from User.

## Actual source boundaries

`prisma/schema.prisma` now has ChatGroup and ChatGroupCreation metadata/receipt models,
but no human topic/message/participant model.
`TelegramConversation` stores one user's bot UI selection and model preferences,
not group membership or message history. Coding session thread IDs and provider
events are execution identities, not authenticated conversation participants.

`User` requires workspace and globally unique phone identity, with PENDING / OPEN /
BANNED / DELETED lifecycle. `AuthenticatedUser` and access JWTs resolve a persisted
OPEN User. Registration checks phone/Telegram verification and establishes username
and password. There is no authenticated-agent principal, service credential,
agent registry, separate employment lifecycle or authorized human-on-behalf-of-agent
message operation. Existing role grants govern workspace APIs; they do not grant
group ownership or invitation authority.

## Independently bounded work and dependent foundation

Group metadata creation and creator-only read/retry are independently definable
for existing authenticated OPEN User accounts: a stable group ID, name, persisted
creator ownership and durable request identity, without invitations, other-member
visibility, agents, history or messages. This bounded batch is implemented,
without constituting usable group chat. It must not claim creation of a
structured DM invitation or grant access to stored history. The approved rule allows
any active account, so it must not add an unapproved role/create-permission gate.

Invitation delivery and acceptance are not independent: there is no human direct
conversation or durable message/component model. Persisting an invitation row or
returning a card to its issuer alone would not satisfy DM delivery. No Telegram
relay, task comment, text-only message or external integration may substitute.

Start with one explicitly owned group and explicit participants, rather than
inventing every conversation surface. Required contracts are stable group/owner
identity, authenticated actor identity, admitted membership, owner/trusted-admin
managed invite grants, admission/revocation and the selected history boundary. Every message,
reaction count/actor, reply/quote, search, preview and stream must use the same
current participant/history visibility. Topic limits require per-topic sequence
identity under the approved per-topic policy. Project-thread audience inheritance and
cross-workspace direct chats remain separate decisions, not defaults for this group.

## Essential authority/identity questions to resolve together

1. **Trusted-admin appointment and invitation delegation:** does the owner appoint
   trusted admins, and may those admins appoint more admins or grant ordinary
   members invitation rights? Recommendation: only owners appoint/remove trusted
   admins; owners/admins manage explicit member invitation grants, with no
   self-elevation or implicit workspace-role override. Appointment/delegation
   authority and owner transfer remain unapproved.
2. **Agent provisioning/ownership contracts:** persistent identity and dedicated
   agent capabilities are now selected. Resource scope, credential/delegation
   lifecycle, transfer acceptance and effects on old controllers/grants/active work
   remain pending. Existing coding sessions are not principals. No credential or
   workspace-admin authority is inferred; the agent gap record tracks these choices.
3. **History admission boundary:** who selects the history option for an admission,
   and do later setting changes or rejoining change the previously granted window?
   Per-topic pre-join counting and default None are approved. Recommendation: freeze a selected
   window on accepted admission; define any later change explicitly rather than
   retroactively exposing old content. Counts,
   quotes, attachments and actor/reaction views must not reveal excluded history.

Only the metadata/creator-read batch above is independent of these decisions.
Invitation, other-member access, agent and history batches must await their relevant
authority/identity/history contracts. At the original documentation-audit checkpoint,
the prior runtime milestone was 816 tests in 49 suites and the isolated database
was stopped. No runtime tests were needed for this documentation-only audit.
Subsequent approved comparator implementation/testing is recorded separately in
[exact deadline sorting](exact-deadline-sort-contracts.md). Existing staged and
unfinished work is preserved; no commit, push, deployment, production migration or
live settings. The runtime checkpoint before metadata implementation was 822 tests
in 49 suites. Metadata implementation and its newer verification are recorded in
the linked contract, superseding the historical documentation-only status here.
