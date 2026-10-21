# Own group-message reactions — 20 October 2026

This local increment implements the approved several-distinct-own-emoji behavior
on existing group messages. The user explicitly confirmed that disabling new
messages affects text sends only: members can still add/remove their own reactions
on messages they may see. No new permission key/default or live grant is added.

## API and output

`PUT /chat-groups/:groupId/messages/:messageId/reactions` accepts exactly
`{emoji,present}`. Emoji is one supported Unicode grapheme, at most32 code points
(at most64 UTF-16 units); standalone modifiers, concatenated emoji, arbitrary text,
custom assets and unknown fields are rejected. The existing Unicode validator
primitive is reused without adopting profile authority/audience policy. Exact
sequences remain distinct, including presentation/skin-tone variants; there is no
automatic folding. `present` must be a boolean.

The authenticated account sets only its own desired presence. Adding an emoji
preserves its other emojis and everyone else's state; removing an absent own
emoji succeeds without touching another account. The200 no-store response is
only `{emoji,present}`. There is no arbitrary actor selector or bulk replacement.

`GET` on the same path returns `{items,nextAfter}`. Each item contains only
`{emoji,count,mine}` for a populated emoji group. `limit` is1–100, default50;
`after` must be a valid exact emoji and comes from `nextAfter`. Ordering and the
strict greater-than continuation use the same database emoji comparison. Pages
are bounded current state, not a frozen historical snapshot. Concurrent changes
can affect later pages; removing the anchor does not break keyset continuation.
No reactor IDs/profiles/roster, timestamps, hidden-message counts, raw message
sequence or membership boundaries are exposed. Existing message/history DTOs
remain unchanged. There is no push delivery or frontend wiring in this increment.

## Authority and hidden history

Every read/add/remove locks the authenticated Workspace, group, current account
and membership in the established order. Under READ COMMITTED it rechecks OPEN
human state, unchanged authenticated workspace context, current admission, exact
message/group association and the message's actual topic partition. Explicit
cross-workspace admissions work; workspace/admin/invitation roles alone do not
grant group access. Pending invitations remain insufficient.

History and reactions now share the same lower-bound calculation: NONE sees
post-admission messages; LAST_100/300 uses the frozen first sequence separately
per topic plus post-admission messages; ALL retains all existing messages.
Missing legacy proof fails closed409 before reaction message lookup. ALL does
not require old proof. Invalid selected-topic boundaries fail409. Missing,
wrong-group, nonmember and hidden-message targets use the same opaque404. A
known message ID cannot bypass the history window, even for removal or an empty
reaction read. Current group sequence bounds also apply. Cursor encryption is
still required by the existing history reader; reactions expose no raw sequences
and do not introduce a second message-history cursor.

The same group fence serializes reactions with admission and sending-policy
changes. Restriction wins or loses that fence without denying reactions; it still
denies an ordinary member's new text send. Revocation/account changes that win
admission deny the next operation. An already committed operation is not
retracted. Stored reactions are preserved after revocation; no automatic purge,
moderator removal, rejoin transfer or new account lifecycle policy is introduced.

## Idempotency, uncertainty and persistence

The additive `ChatGroupMessageReaction` table has a composite primary key
`(messageId,accountId,emoji)` and a `(messageId,emoji)` index. Message/account
foreign keys mirror existing message lifecycles: message deletion cascades;
account deletion is restricted while referenced. No message edit/delete endpoint
is added. Migration `20261020080000_group_message_reactions` backfills no reactions
and rewrites no messages, sequences, admissions, boundaries, owners or grants.

Desired-state upsert/delete is transactionally serialized, including separate
clients. Duplicate identical requests retain one/zero rows. Opposite intentions
apply in accepted lock order; there is no historical request receipt, revision or
stale-intent protection. After uncertainty, reread current state and reconcile the
current intent before retrying; an old add replay after a later removal is a new
desired-state command, not a historical receipt. No automatic retry occurs.

Known read availability failures return sanitized503; unknown read failures
retain500. Writes retain the existing database-operation classifier, including
P2028 `OPERATION_OUTCOME_UNKNOWN`503, constraint/state conflicts and unknown500.
Raw errors, private database details, IDs or hidden content are not added to
error envelopes. Lost committed add/remove acknowledgements are tested, as are
rollback and absence of automatic replay.

## Verification and remaining scope

Full regression passed **1,893 tests /96 suites** in412.504 seconds; focused
verification passed **144 tests /6 suites** in49.603 seconds, zero failures/skips.
All46 new reaction tests passed. Strict typecheck, lint, format, build, release,
schema validation/parity, Bash/ShellCheck and38 local mock deployment checks
passed. The documented one recycled128 MB worker/isolated-ts-jest/30-second Jest
budget was used; strict whole-project typecheck/build passed separately, with no
application/helper timeout or repository runner configuration changed.

Final counts and exact evidence are recorded in
`group-message-reactions-verification-20261020.json`. Synthetic coverage includes
multiple/distinct/duplicate reactions, concurrent clients/opposite intentions,
other-account and other-emoji preservation, exact Unicode variants, pagination
bounds/anchor removal, per-topic NONE/LAST100/LAST300/ALL and legacy history,
nonmember/wrong-group/hidden-message isolation, revocation/account races,
cross-workspace admission, sending-policy races, lost acknowledgements, rollback,
sanitized/unknown errors, foreign keys/uniqueness, and explicit OpenAPI DTOs.

All79 pre-existing fixture table row digests matched immediately across the real
additive migration; the only added table was empty. A separate rolled-back
scratch-schema exercise of the actual migration preserves synthetic legacy text,
order and account state and invents no reactions. Schema parity and final fixture
cleanup are recorded separately. Only the synthetic local fixture was migrated.
The fixture stopped, its listener and10 known logged worker PIDs were absent,
and the exact owned cache was removed after path/reparse checks. Final reactions,
review/vote rows and scratch schema were zero; the exact nine existing platform
trigger names matched their allowlist with no extra/fault triggers. The fixture
was briefly reopened only to distinguish permanent platform triggers from fault
triggers by exact names, then stopped again; no tests were repeated for that check.

No complete-conversation checklist closure is claimed. Message edit/delete,
topic management/discovery, rejoin, reactor rosters/profiles, ordinary DM reactions,
notifications, read receipts and frontend/production activation remain separate.
No source implementation or actual publication was performed for articles.
For later article work, editor-proposed content/placement/order changes now need
the same review and accurate immutable before/after comparison; current published
versions must remain readable while proposals are reviewed. Stale-base/concurrent
promotion remains unresolved, so shared published-tree integration stays paused.
That later backend comparison is not a claim that a change UI exists.

All work remains local/uncommitted. Prior evidence and Library snapshots remain
historical; this reaction increment was not uploaded. No production operation,
Postman, credential change, paid call, commit/push/deployment, live permission,
agent, username/phone or presentation work was performed.
