# Invitation card handoff — actual backend contract

These routes/DTOs are implemented locally and undergoing group-batch verification.
Visual design is independent and must not add permissions or product states.

`GET /api/v1/direct-conversations` discovers the authenticated account's two-party
invitation DM threads. `GET /api/v1/direct-conversations/:conversationId/messages`
returns `items`, `hasMore`, `nextAfterSequence`; query `afterSequence` and `limit`
(default50/max100). Each item has:

```text
id, kind="GROUP_INVITATION", sequence, createdAt
invitation:
  id, groupId, groupName, inviterId, recipientId,
  mode="APPROVABLE", historyAccess, status,
  conversationId, createdAt, resolvedAt
actions: { accept: boolean, decline: boolean }
```

groupName is frozen at invitation creation and rendered as plain text. Inviter and
recipient IDs are actual account identities; the existing viewer-authorized
`GET /api/v1/profiles/:accountId` can resolve public display identity. The card
does not contain private profile fields, phone, workspace affiliation or a roster.

| Actual state                                        | Recipient display/actions                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PENDING, actions.accept=true                        | Inviter, group, selected earlier-history option; Accept and Decline.                                             |
| PENDING, actions.accept=false, actions.decline=true | Currently unavailable to accept; Decline remains available. No claim that it expired or was permanently revoked. |
| ACCEPTED                                            | Accepted/admitted; no action buttons.                                                                            |
| DECLINED                                            | Declined; no action buttons.                                                                                     |
| Sender's view                                       | Current state; accept/decline both false.                                                                        |

The authoritative decision is
`PUT /api/v1/direct-conversations/:conversationId/invitations/:invitationId/decision`
with `{accept:true}` or `{accept:false}`. Preserve that invitation identity after
response loss; repeat only the same decision or reread the card. Opposite decided
state conflicts. The server rechecks recipient and current inviter authority;
actions are a read snapshot, not a capability token. On rejection reread rather
than optimistically showing admission.

History labels: NONE, LAST_100, LAST_300, ALL. They describe the inviter-selected
admission policy, not a guaranteed count of available messages.100/300 means per
forum topic. This first slice has no group topic/message retrieval; do not invent
message counts or a history preview from the selected policy.

DIRECT is different: owner-granted inviters create it through
`POST /api/v1/chat-groups/:groupId/invitations`, and its result is ADDED with
conversationId=null. It admits immediately and creates no approval card. A
direct-add notice visual must not show Accept/Decline. There is no separate
direct-add notification component/API in this batch; the recipient discovers its
membership through `GET /api/v1/users/me/chat-groups`. A dedicated notice design
is a proposal until its delivery/read-state contract exists.

EXPIRED and permanently REVOKED are not implemented states; no expiry duration,
revocation endpoint or tombstone was selected. Grant removal disables acceptance
while pending; restoring the right can make that pending card usable again.
Group membership, unrestricted group history, arbitrary messages and ordinary DM
consent are not granted by possessing a card or conversation ID.
