# Persistent ProboxAI agent architecture/API gaps — October 14

## Confirmed architecture and capabilities

Planned ProboxAI agents are persistent platform participants that collaborate
with humans and other agents. They can launch Codex coding sessions as work.
Codex sessions are execution resources and cannot act as platform participants.
Planned agents are not implemented at this checkpoint.

The owner requests dedicated capabilities for agent creation, agent management,
agent group access, agent permission management and agent ownership transfer.
These are separate future capabilities. A workspace-owner or ADMIN label must
not implicitly grant all of them. Exact permission keys, resource scope, default
grants, lifecycle and transfer procedures remain contracts to define. No permission
definition, grant, credential or agent runtime is created by this record.

## Verified current boundary

`AuthenticatedUser`, access JWT lookup and lifecycle checks target persisted OPEN
User accounts. Users currently have phone/Telegram-backed registration and workspace
role assignments. There is no persistent agent principal, agent authentication,
scoped service credential or agent ownership record. `ProboxAiSession` stores
execution, lease, process and provider-thread identity. Neither a session UUID,
`codexThreadId`, worker process nor tool output may be retrofitted as an agent
principal or used to impersonate a human. No fake phone registration or reused
human JWT is an agent identity solution.

## Future contracts to track

| Gap                                     | Required contract and acceptance                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent identity and lifecycle       | Stable agent identity, public participant projection, workspace/resource scope, owner/controller relationship and enabled/disabled lifecycle. Historical messages/reactions keep attribution; disabling blocks subsequent authenticated actions. Profile lookup remains viewer-authorized                                     |
| Creation and management                 | Distinct explicit creation/management permissions with fresh resource-scope checks, validated configuration, durable request identity, audit/readback and uncertain-outcome recovery. Management does not imply permission delegation, group access or ownership transfer                                                     |
| Authentication and runtime provisioning | Explicit revocable credentials/delegation, rotation/revocation, runtime ownership, execution limits and recovery. No secrets in group/profile/API projections. No credentials are minted before this contract is selected                                                                                                     |
| Group access and collaboration          | Dedicated authority for controlling an agent's group access plus the group's invitation/acceptance/permission/history rules. Agent management permission must not bypass the group. Agent messages/reactions/reads use the agent identity and cannot change a human's unread cursor. Admission and invocation remain separate |
| Agent permissions                       | Dedicated permission-management authority, allowed scopes, privilege-escalation prevention, revision-safe whole-set changes and audit. Do not grant the manager their own missing rights through an agent, or silently reuse human role-assignment semantics                                                                  |
| Ownership transfer                      | Separate transfer authority; eligible target, source/recipient consent, workspace changes, pending work, credentials, grants/group memberships and audit/retry semantics must be explicit. No silent transfer of secrets, history access or old-controller powers                                                             |
| Agent-launched Codex work               | Preserve the distinction between agent participation and coding sessions. Define who may launch/interrupt sessions on whose behalf and which task/project/session permissions apply. Execution result ingestion requires an allowlisted, provenance-aware contract; session output is data, not authority                     |

These acceptance topics are proposed engineering contracts to define, not approved
defaults. Existing task/session permissions and assigned-manager boundaries remain
unchanged. Agent participation must not automatically consume provider budget or
invoke work merely because an agent is mentioned, invited or receives a reaction.

## Smallest essential choices before an agent runtime batch

1. **Resource/ownership scope:** are agents workspace-scoped resources with an
   individual human owner/controller, and which targets may receive ownership?
   Recommendation: explicit workspace scope and stable responsible ownership,
   with no workspace-owner/admin bypass of dedicated capabilities.
2. **Transfer and revocation:** does the recipient accept a transfer, and what
   happens to old-controller credentials, grants, group access and active work?
   Recommendation: explicit accepted transfer with audited/revision-safe changes;
   select each revocation/work effect rather than infer it.
3. **Provisioning/delegation:** how will an agent authenticate and launch Codex
   work, and who may disable individual agent access? Recommendation: dedicated
   revocable credentials/delegation scoped to selected actions/resources, retaining
   task/project/session checks. This remains unimplemented pending contracts.

The approved human group metadata create/creator-read candidate does not require
agent provisioning. Group permission delegation/trusted-admin appointment and
history boundaries remain pending separately. Structured interactive invitation DM
delivery requires the missing durable human DM/message foundation.

## Status and evidence

This documentation-only update preserves runtime code, schema, grants and current
staged/unstaged work. No migration, credential minting, session-ID reuse, staging,
commit, push, deployment or production/security setting change. Formatting and diff
checks passed; no runtime tests were rerun. Latest runtime milestone: 822 passing
tests in 49 suites. The isolated test database remains stopped. Parent owns API-gap
IDs/checklist and readiness status.
