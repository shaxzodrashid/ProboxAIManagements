# Inactive delegated bio domain foundation

Available since local **0.3.0-dev.7**. This is an internal domain foundation,
not activated delegation, a public API or end-to-end agent functionality.
No production identity/persistence adapter, HTTP route, Nest provider,
credential, persistent runtime access, migration or permission grant is added.

## Activation is blocked

`DelegatedBioFoundation` is not registered or called by the application. Missing
either trusted identity or atomic persistence port returns503
`DELEGATED_BIO_NOT_ACTIVATED` before resolution or mutation. A feature flag,
environment setting, request body, agentId or trusted:true cannot activate it.
An agent ID in an owner approval identifies the intended assistant; it never
authenticates the caller as that assistant.

The test identity adapter accepts opaque fixture proofs, never an actor-shaped
request. The test repository serializes copy-on-write transactions. These prove
domain behavior and simulated rollback only. They establish neither production
authentication nor PostgreSQL durability. No production adapter is supplied.

Activation requires ALL of the following together:

1. Persisted, authenticated agent principals, employee-owned links and independent
   credential/link revocation. Resolve employee subject server-side and reverify
   actual actor inside the same current transaction. Existing human access tokens
   and Codex session IDs are not agent identities. No live credential is created
   by this batch.
2. Real atomic persistence for approvals, revisions, receipts, attribution and
   current badge state. Repository state must come from authoritative current
   employee OPEN/workspace, link and grant data, not supplied snapshots. All
   selected writes must serialize under the same resource/authorization rules.
3. Coordinate every existing human bio writer, including PATCH self and combined
   profile Save, with this protocol without breaking their contracts. The domain
   `humanWrite` is a modeled writer, not a replacement currently used by those
   routes. Existing routes remain unchanged only because activation is impossible.
4. Hook every effective owner-permission writer into permanent downward removal
   in the same transaction as permission loss. Request-time intersection alone
   cannot remember loss followed by regain. Role unions, lifecycle changes,
   bootstrap/administration and future writers must be reconciled before enabling
   any delegated executor. Add real HTTP/database/authorization migration and
   concurrency verification; in-memory tests are insufficient.
5. Deliberately version read projections and frozen receipts. Use the existing
   bio viewer-audience checks for public content. This foundation adds no public
   actor-history endpoint or disclosure of prior private values. Broader detailed
   history visibility remains pending.

## Modeled rules

Only a trusted employee principal can create/manage a modeled linked assistant,
approve a replacement, perform a human overwrite or read detailed model history.
Only a trusted agent principal matching that owner's enabled assistant may execute.
An OPEN employee, matching workspace and current content capability are checked
inside every transaction, including receipt replay. Other owners, unrelated
agents, employee proofs masquerading as agents and forged actor selectors fail.
Returned data is cloned and actor fields are allowlisted.

Creating a modeled assistant snapshots all current effective owner permission
keys once. Later gains do not add keys. `applyBioOwnerPermissionChange` is an
internal transition for trusted effective-permission writers: it permanently
removes keys no longer held. Regain does not resurrect them; only explicit owner
addition of currently held keys does. Removing one role while another retains
the permission is not effective loss. These are modeled semantics, not active
hooks in current authorization writers. Profile self bio edits presently require
no workspace permission key; the separate owner-selected content action scope
and exact approval remain necessary for agent bio execution. No fictitious
workspace profile permission or blanket privacy grant is introduced.

Content and privacy action scopes are distinct owner-selected booleans in this
model. Neither implies the other; there is no privacy execution method. Unknown
privacy, Contacts, subject or actor fields in bio commands are rejected rather
than ignored. Existing audience policies and Contacts operations are unaffected.

Every agent bio edit requires an authenticated employee's exact approval for that
specific agent, proposed bio and observed revision. In this bounded slice approval
also serves as the applicable owner instruction; it grants no unrelated work,
teammate reply or general autonomous execution. Even initial/null bio population
uses this explicit approval path. Approval creation leaves content and badge
unchanged. No expiry, blanket reusable approval or inferred instruction is added.
The approval records its owner and time; execution records approval identity.

Execution accepts only approvalId and requestId, obtaining the replacement from
the stored approval. It atomically checks revision and unused approval, writes
bio, advances revision, sets current AI badge and appends actual-agent history.
Null clears and empty string remains a configured value. Plain text remains
literal. Validation applies the existing1000-character class-validator boundary
and PostgreSQL varchar1000 code-point storage boundary; no new HTML or trimming
semantics. No privacy values, file paths or credentials belong in these commands.

Human writes share the modeled revision/receipt/history protocol. An intervening
human or other-agent write makes an unconsumed approval stale; it cannot silently
rebase. A human overwrite clears the current AI badge, including an explicit
same-value overwrite. Original agent actions remain truthful immutable history;
no creation badge survives as a substitute. Failed approval/write attempts do not
change content, badge or history.

Exact request replay returns its historical outcome without applying it to current
state. Late agent replay cannot restore a badge/content over a newer human edit;
late human replay cannot clear a newer agent badge. Changed request reuse conflicts.
All approval use, revision, content, badge and receipt/history changes are atomic
under the repository contract. No uncertain outcome is retried with a new identity.

## Scope and verification

The fixture suite covers missing-port gates, forged/other actor proofs, separate
content/privacy scopes, grant snapshots/effective-union loss/regain, exact manual
approval and stale revisions, duplicate/racing agents and human writes, replay
after overwrite, current link/credential/owner/workspace revocation, injected
commit failure, literal/empty/null/maximum Unicode bio values, forged fields,
history retention and returned-copy isolation. The actual application profile,
privacy, authorization and other regressions must still pass unchanged.

No real human-writer coordination, real permission-loss integration, persistent
approval, public badge delivery or live agent execution is claimed. No checklist
ID is closed. The later owner simplification removes availability overlap/fallback
and employee-roster dependencies for status: see
[shared manual availability](shared-manual-status-contracts.md). Broader history
disclosure and SESSION07 command-output policy remain separate pending contracts;
any independently selected employee-roster feature retains its own contract.
The separately uncommitted linked-agent assessment and user README are preserved.
