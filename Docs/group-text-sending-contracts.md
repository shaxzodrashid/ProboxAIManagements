# Admitted human group text sending — 20 October 2026

Later increment: bounded history retrieval is now implemented separately in
`group-message-history-contracts.md`. The no-history statements below describe
this original sending slice, not the newer reader.

The user selected ordinary sending for admitted OPEN members by default. No extra
owner grant is needed to participate. This local slice adds plain-text sends,
author-only send receipts and explicit owner restrictions. It does not claim full
CONV01–04 completion: topic/history browsing, reactions, edits/deletes, ordinary
DM text, removal/rejoin and agents remain separate work.

## Routes and recovery

- `POST /chat-groups/:groupId/messages`: UUIDv4 `requestId` and `text` containing
  a non-whitespace character, maximum4000 characters. Text is preserved exactly;
  it is plain text, without HTML execution, attachments or tool actions. Server
  chooses identity, author, group sequence and timestamp. Unknown fields/selectors
  are rejected by the application validation pipe.
- `GET /chat-groups/:groupId/messages/by-request/:requestId`: current admitted
  author only. Other authors/nonmembers receive opaque404. No public history,
  roster or other participant's message lookup is introduced.
- `GET /chat-groups/:groupId/sending-policy`: current admitted OPEN human only;
  returns `membersCanSend` and independent `revision`.
- `PUT /chat-groups/:groupId/sending-policy`: current admitted OPEN owner only,
  `If-Match` revision and strict boolean `membersCanSend`. Default true. False
  restricts new sends to the current admitted OPEN owner. True restores normal
  member sending. This bounded group-wide switch implements the explicit owner
  restriction; individual member overrides are not inferred.

The immutable group/author/request key plus exact text deduplicates retries,
including concurrent submissions. Different text under the same key conflicts409.
Same UUID under another author/group is a distinct scoped request. A lost response
must be reconciled with the same request/input. Missing404 does not prove an
in-flight request cannot still commit. Recognized transaction uncertainty is503
`OPERATION_OUTCOME_UNKNOWN`; unknown failures retain500. Read dependency outages
return sanitized503, never an empty successful result.

Changing a sending policy does not revoke the author's ability to reconcile a
previously accepted message while still OPEN/admitted. Matching replay returns
that existing message without allocating a sequence. New requests are denied
after restriction. Removal or account ineligibility denies both replay and reads.
No auto-expiry/deletion of messages or receipts is added.

## Authority and ordering

Writes lock the actor's current authenticated Workspace, then ChatGroup, User,
and current membership row. They recheck persisted OPEN state, unchanged actor
workspace context, current membership and owner policy under that fence. Sends
and owner policy changes serialize on the same group; accepted messages receive
one unique increasing group sequence atomically with insertion. Failed insertion
rolls back the increment. Policy changes atomically increment their own revision
and append an audit; same-value writes do neither. Stale revisions conflict409.

Current workspace membership or administrative roles alone never confer group
access or owner authority. These are existing platform conversations: explicitly
admitted cross-workspace participants remain permitted under the approved admission
contract. This does not grant access to either workspace's projects, profiles or
other conversations. Pending invitation cards are not admissions. Sending grants
no invitation-management, permission-delegation or administration authority.

The membership row lock also serializes an actual concurrent row deletion. A
deletion/restriction that wins admission prevents a new send; this is not a promise
to retract an already accepted message. Future removal/rejoin routes must preserve
the shared lock order and apply their deliberately selected lifecycle/history rules.

No historical message browsing is added. The stored NONE/LAST100/LAST300/ALL
admission policies are unchanged. Topic-scoped history readers must implement
their selected admission windows before exposing another participant's content;
the new group sequence is not a substitute for per-topic history accounting.

## Migration and validation

`20261020020000_group_text_sending` is additive: true/zero defaults on existing
groups, new message and policy-audit tables, scoped unique retry/sequence keys and
foreign keys. It does not alter owner, memberships, invitations, selected history,
workspace permissions or existing creation receipts. No historical messages are
invented. Ordinary PostgreSQL DDL locks/coordinated rollout are still required.
Only the isolated loopback fixture is migrated; no production operation occurs.

See `group-text-sending-verification-20261020.json` for exact final checks. This
increment is newer than both the1418-test private Library archive and the1424-test
project-authority checkpoint; no Library or Postman update accompanies it.
