# Bounded admitted group text history — 20 October 2026

This slice adds browsing of existing group text messages. Sending, invitation
rights, frozen admission history and explicit cross-workspace participation retain
their existing contracts. It does not close CONV01–04. Final evidence is in
`group-history-verification-20261020.json`; earlier verification remains historical.
Final frozen-source regression: **1,616 tests /90 suites passed** in327.545 seconds.
Focused: **98 tests /5 suites passed** in65.062 seconds. Both runs have zero
failures/skips;21 tests are new. Static/build/release/schema checks,
Bash/ShellCheck and all38 mock deployment checks passed. Final schema parity
remained clean, the fixture stopped, and no owned test process/listener remains.

## Scope and settled decisions

The19 October admission contract supersedes older invitation recommendations:
owner-granted invitation rights, DIRECT immediate admission, APPROVABLE recipient
acceptance, and inviter-selected NONE(default)/LAST_100/LAST_300/ALL without another
owner/admin approval.100/300 count messages before joining separately per topic.
Pending invitations grant no history access. Group sending restriction controls
new sends; it does not remove an admitted member's reading authority.

No topic-management, topic-discovery, private-topic audience, member removal/rejoin,
retroactive history change, ordinary DM, reactions, edit/delete, read receipts,
agent or profile-disclosure policy is introduced. Article publication remains
disabled pending voter-list ownership. Presentation future features are unrelated.

## Read route and output

`GET /chat-groups/:groupId/messages` accepts only:

- Optional UUIDv4 `topicId`; omission selects existing unthreaded messages.
- `limit` integer1–100, default50.
- Opaque `cursor`; retain the same topic and page size for continuation.

Responses are no-store and contain `{items,nextCursor}`. Each item contains only
`id`, `authorId`, `text`, `createdAt`, and nullable `topicId`. Messages are newest
first by immutable accepted order, including when timestamps are equal. Render
text as plain text. No raw sequence, admission cutoff/epoch, hidden counts,
requestId/send receipt, workspace identity, profile hydration or roster is exposed.
No search, preview, quote or media resolver bypass is added.

Each request locks the authenticated Workspace, group, requesting User and
membership in the existing order, then reloads the OPEN account/current workspace
and admitted membership. Reads use READ COMMITTED so a revocation that wins these
locks is visible at admission. No workspace role, project grant, invitation card,
cursor or author receipt substitutes for current membership. Explicit admitted
cross-workspace members remain supported. A fresh request after account removal/
ban fails; stale actor/workspace context is rejected. Every page reauthorizes.

Current account rejection is403 in the service (the bearer guard normally returns
401 for a non-OPEN account); unavailable membership/group is opaque404. Recognized
database availability failures use the existing sanitized503 read contract;
unknown failures retain their existing error handling. No empty success masks an
outage. Unknown selectors and invalid page inputs return400.

## Durable admission boundaries and per-topic windows

New group-owner membership records cutoff0. DIRECT records the current accepted
group sequence under the shared group fence; APPROVABLE records it at acceptance,
not invitation creation. New membership also receives an opaque admission epoch.
Exact invitation/acceptance replay preserves the original boundary and epoch.

For LAST_100/LAST_300, the same transaction ranks pre-admission messages separately
inside each partition and persists the first permitted sequence per partition.
It does not subtract100/300 from the group-wide sequence. NONE permits only later
messages. ALL permits all retained messages. A partition first populated after
admission has no pre-admission window and permits later messages normally.
All new admissions, boundaries, invitation outcomes and card effects commit or
roll back together. Failure to preserve boundaries does not leave membership.

The application treats existing unthreaded messages as the null partition;
its internal boundary key is MAIN. Tagged partitions use canonical UUIDs. This is
an additive storage/reader foundation, not a new topic object/catalogue or topic
creation right. Current POST sending remains unthreaded; topic IDs are not newly
accepted on sends. Synthetic import fixtures exercise multiple partitions. Future
authorized topic writers must retain the shared group fence and immutable
group/topic/sequence placement; management or moving messages is not implemented.

Frozen lower boundaries cannot expand after messages disappear, including before
the first read. They do not reference a message row that deletion could cascade.
Initial reads freeze an upper accepted sequence. Continuations retain that upper
bound, so new sends appear only after restarting paging. Deleting an anchor in a
synthetic fault test does not break continuation or expose older excluded history.
No application message deletion endpoint is added.

## Opaque continuations

Continuations use versioned AES-256-GCM authenticated encryption with a fixed-size
512-byte payload, fresh nonce and dedicated domain. They conceal internal sequence
values and their magnitude. Key material is derived with domain separation from
the existing configured JWT_SECRET; no new secret, credential issuance or token
storage table is introduced. The production module supplies this derived key;
missing configuration fails closed503. Tests inject only a synthetic key.

Tokens bind actor, current workspace, group, topic, page size, membership epoch/
policy/cutoff/invitation/join time, frozen visibility floor, snapshot ceiling and
next position. Malformed/tampered/wrong-scope tokens return400; changed admission
or history generation returns409. Tokens are not authorization and never expand
current visibility. The key remains stable across process restarts with the same
configured secret. Secret rotation invalidates old continuations; restart paging.
There is no newly selected content or continuation retention TTL.

## Legacy preservation and migration

`20261020060000_group_history_boundaries` adds nullable message topic UUID, nullable
membership cutoff/epoch, a partition/order index and a membership-scoped boundary
table. It rewrites no IDs, text, sequence, author/request identity, message time,
membership policy/time/invitation, grant or retained card. No historical cutoff,
topic identity, epoch or window is backfilled. Existing null topic remains the
existing unthreaded partition; records are not moved or renamed.

Legacy ALL can read safely without an admission cutoff because its existing
grant already includes every retained message. Legacy NONE/LAST_100/LAST_300 with
no proven cutoff/epoch return `GROUP_HISTORY_BOUNDARY_UNAVAILABLE`409. Reads do not
guess from timestamps, rewrite membership, repair history or widen a grant.
The records remain intact. Enabling those historical memberships later requires
trustworthy evidence/reconciliation; no grant-changing repair endpoint is added.

The actual migration passed a fully rolled-back scratch-schema check preserving
representative old rows/values with all new legacy fields null and no fabricated
boundary rows. It was applied only to verified localhost55439/profile_test;
Prisma reported no schema drift. Production migration/activation is separate.
Coordinate writers before activation: old admission writers omit the boundary and
therefore create memberships whose restricted history reader fails closed. Retain
the additive fields/table on rollback; no destructive down migration is supplied.

## Validation and handoff

The focused set covers history HTTP/database/cursor tests plus existing group
admission/sending/metadata regressions. It includes exact100/300 windows in three
interleaved partitions, NONE/ALL, equal timestamps, frozen lower windows and upper
snapshots, absent anchors, token scope/tampering/constant size, revocation/account/
workspace changes, pending and cross-workspace admissions, acceptance-time capture
and replay, atomic boundary rollback, legacy preservation, and safe failures.
Exact frozen-source full/focused counts and hashes are in the verification JSON.

Frontend: read the chosen partition, render returned items as plain text, retain
the opaque continuation and unchanged query, restart on400/409 as appropriate,
and stop on denied access. A legacy-boundary409 means unavailable history with
preserved data, not an empty conversation. Do not derive unread counts or a group
roster from page contents. No read marker or automatic mutation retry is implied.

Remaining scope: topic-management authority and APIs, legacy evidence-based
history reconciliation, removal/rejoin and retroactive policy, message lifecycle,
ordinary DM text, reactions/read receipts, broader conversation features,
frontend wiring and coordinated production activation. No new product decision
blocked this bounded initial-admission reader. No Postman, uploads, push/deploy,
production data/migration, live grant/security change, paid call, agent,
username/phone or presentation work occurred.
