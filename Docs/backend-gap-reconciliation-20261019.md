# Whole-backend gap reconciliation — 19 October 2026

Scope is the entire backend: accounts/profiles, projects/tasks/files/templates,
Telegram, sessions, authentication, API completeness/reliability, conversations,
agents and articles. Login-to-session readiness is one workstream, not the boundary.

## Current source and evidence

- Started from clean `dev`, HEAD `b6b55e3826d3e8a2a3c6009845879a859cdfe88d`.
  The prior BFF/harness work is now committed by the owner; no branch/reset/stash
  or history rewrite was performed. Root/nested AGENTS and local agent instruction
  locations were checked; none adds a backend implementation rule here.
- Read the current API checklist/account Page and the repository's readiness,
  overnight/profile reviews, feature catalogue, task-sharing, conversation/agent,
  file-containment, Telegram and BFF/initial-create inventories. Earlier prose is
  historical when later source/test evidence supersedes it.
- The current checklist contains63 checkbox rows:23 checked and40 unchecked. Its
  introductory22/41 count is stale. Several unchecked umbrellas already contain
  substantial implemented subsets. No shared checkbox/status was changed here.
- Prior BFF verification reports1,285 tests/71 suites.32 of its34 recorded source
  hashes still matched at this audit; the committed `.env.example` and Prisma
  schema have different bytes. Current disabled browser defaults and the additive
  BrowserSession model were inspected rather than relying on old hashes. New work
  receives its own verification; old artifacts remain historical, unchanged.

## Reconciled implementation coverage

| Area                             | Verified existing local subset                                                                                                                                                                                                       | Concrete remaining boundary                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API01/02/03/10/11/12/13          | Authoritative self identity, independent names/admin creation, optional bio/date-only birthday, field audiences/Contacts/private aliases/picker, atomic Save, manual availability/custom status, staged avatar/crop/publish/delivery | Live private avatar storage/principal verification remains deferred. Username/phone edits and unselected account policies are not silently included. Frontend/privacy acceptance is broader than these API subsets.                                                                       |
| API06 and browser authentication | Encrypted server-held-token BFF, opaque cookies, origin/CSRF, browser-only logout, current-account/workspace/grant fences; actual controlled Chrome login/setup/completion                                                           | Production TLS/key/rotation/retention/edge operations are disabled/unverified. Account-wide/legacy-JWT revocation and activation/recovery browser transport are not selected by this implementation.                                                                                      |
| Projects/tasks/workflows         | Scoped member picker, creation/enqueue recovery, project deletion state; human task query/detail/edit/assignment, boards/workflows, checklists/deadlines, sharing association/state and creator-only confirmation                    | Full shared-board content/comment/audit visibility, bidirectional edits/removal propagation and reopening still require selected rules. Typed references/attachment identities remain separate.                                                                                           |
| Sessions                         | Durable turns/events, authoritative state, directory/project context, canonical assistant text and safe provisional command metadata; controlled runner integration                                                                  | Initial creation receipts remain proposed. Full rendered output/recovery UI is unfinished. Rich command output/historical diffs, typed inclusion and interactive approvals need source/disclosure/authority contracts.                                                                    |
| Telegram/API09                   | Single editable model panel with validated model-specific efforts, drafts/confirm/cancel, stale/cross-actor protection and guarded save                                                                                              | REST synchronization is conditional and awaiting selection. Link/unlink/relink/recovery authority remains undecided. No live Telegram delivery was invoked.                                                                                                                               |
| Files/templates/departments      | Existing effective upload limits, typed contracts, template concurrency/publication and structured commands, recoverable deletion journal and initialization readback                                                                | Stronger executor containment/restore guarantees and shared/nested department-home policy are not established by path checks or the journal. Production cutover/preflight remains coordinated operational work.                                                                           |
| Conversations/agents/articles    | Bounded creator-owned group metadata/receipts and inactive delegated-bio domain foundations                                                                                                                                          | Durable DM/invitation/message/read-state foundation; admin/delegation/history admission; persistent agent identity, provisioning/ownership/transfer; article forest/block/history/media policies remain substantive gaps. Metadata is not usable chat; sessions are not agent principals. |
| Home/access/preferences          | Existing authorized reads can compose bounded Home views and current permission catalogue                                                                                                                                            | Missing discussion/unread/activity feeds, helper routing/disclosure, new ranking/snapshots/saved views, and optional preferences/password/OTP metadata require their selected scope; not every proposal is approved.                                                                      |

## Prioritized next work and decisions

1. **Existing API correctness/reliability first.** Exercise current profile,
   project/task and Telegram paths for failures that need no new product policy.
   This batch reproduced six post-authentication read outages returning500 and
   implements a narrow read-only503 boundary. It also reproduced and fenced the
   existing Telegram model-save authority race; see the linked contracts below.
2. **Shared-task integration.** Before a destination board can render a full card,
   select which canonical fields/checklists/comments/history its current members
   may read. Keep existing edit scopes until propagation is separately approved.
3. **Initial session retry safety.** Select receipt/fence retention versus an
   expiring-intent protocol before keyed creation. The proposed30-day receipt plus
   task-lifetime non-content fence is a real retention choice, not an approved
   default. Do not start this merely because it is a suggested next batch.
4. **Cross-channel model settings/account completeness.** Select REST access to the
   same personal model/provider/effort settings. Other optional preferences,
   authenticated password change and exact OTP timer metadata remain separate.
5. **Conversation/agent/article foundations.** Resolve owner-appointed trusted-admin
   and invitation delegation, history-window admission/rejoin effects, and human
   DM scope before message delivery. Resolve agent ownership/transfer/delegation
   before credentials or execution. Select article hierarchy/block/history/media
   policy before an editor/storage integration.
6. **Deployment enablement.** Operators must verify avatar storage and principals,
   BFF TLS/origin/key/rotation/retention, and migration preflight/coordinated writers.
   No production operation or credential provisioning is part of local coding.

Three text questions were surfaced early while the owner is available until23:00
Asia/Tashkent (18:00 UTC): shared-task read visibility, initial receipt/fence
retention, and selection of REST/Telegram model preferences. No response is treated
as approval. Independent existing-contract fixes continue while decisions are pending.
The other listed policy choices are an explicit queue for the parent/owner, not
defaults adopted here. The parent retains shared checklist ownership.

## This batch

See [Content-read availability](content-read-availability-contracts.md) and its
verification evidence for exact files, failure injection and regression outcomes.
The independent [Telegram save authority correction](telegram-model-authority-contracts.md)
protects current grants/lifecycle/identity without selecting REST preferences.
No new route, grant, provider/dependency, schema migration or resource visibility
is introduced. Successful payloads and existing mutation recovery stay unchanged.
This bounded correction does not close an entire historical checklist umbrella.

Final verification: 1,332 tests / 74 suites pass; static/build/release checks pass.
[Batch evidence](backend-reliability-verification-20261019.json) records exact files
and local-only results. New Postman approval was supplied, but automatic review
rejected the first description-only write; readback confirms no change. The exact
payload/destination question is pending independently of the three product choices.
