# Viewer-aware profile and audience plan

This is a reviewable implementation plan, not a privacy/settings change. The
current authenticated private self endpoint stays separate; provisional bio
remains self-only. No real contacts, audiences, profile defaults or assets have
been changed.

## Confirmed user requirements

- Everyone is public, without a workspace restriction.
- Names and usernames are public base identity by the latest explicit user decision. This authorizes future implementation, not publication of real account data from this checkout.
- A contact alias belongs privately to the contact-list owner. Preserve actual account identity separately and keep aliases out of public, administrative and other-user responses.
- Custom selection uses workspace parents with account children: selecting a parent creates a dynamic workspace-membership grant; selecting children creates explicit account grants; partial children display indeterminate. Provide only the authorized minimal workspace/account discovery needed for this UI, without turning admin lists into a public roster.
- Contacts is unilateral and belongs to the profile owner: adding B to A's
  contacts grants B access to A's Contacts fields, without granting A reciprocal
  access to B's fields. No mutual acceptance assumption.
- Custom is a union of explicit account recipients and selected workspaces.
  Workspace grants follow current membership at read time. An explicit account
  grant persists when that account changes workspaces.
- Avatar, bio and status have user-controlled Everyone / Contacts / Custom /
  No one audiences. Birthday day/month and year have independent audiences.
- Recipient counts represent entries, e.g. two accounts and one workspace,
  never an inferred distinct viewer count.
- Missing policy, policy-loading failure or unrecognized state fails closed.
  Undisclosed fields start private; existing stored data is never automatically
  published. Frontend public-sharing confirmation does not authorize changes
  to real accounts by an agent.
- Audience membership is profile visibility only. It grants no project, task,
  file, admin or workspace feature permissions.

## Proposed bounded implementation increments

1. **Policy/data foundations and redaction.** Add nullable profile data and
   explicit audience records with private defaults, no public backfill. Model
   recipients as typed account/workspace IDs with uniqueness per owner/field.
   Contacts use directed ownerId/contactAccountId pairs. Validate self updates
   through an explicit allowlist; identity, membership, lifecycle and grants
   remain unwritable. Do not infer or split legacy names. Keep schema migration
   and deployment compatibility explicit.
2. **Viewer-aware profile read.** Build one server-side audience evaluator using
   current persisted viewer identity/membership. Anonymous viewers qualify only
   for Everyone. Authenticated viewers qualify for explicit account OR current
   selected-workspace membership OR the owner's directed Contacts, according
   to each field's mode. Do not trust stale workspace claims or client policy.
   Private self reads return owner data/policy separately.
3. **Safe recipient discovery and contacts/custom-list writes.** Publish an
   explicit minimal discovery contract; never reuse workspace admin user lists
   for global search or leak a private workspace roster. Scope edits to the
   caller owner and validate account/workspace eligibility without disclosing
   hidden existence. Replace per-field Custom entries atomically and return
   entry counts. Contacts require no reciprocal write or notification.
4. **All identity projections.** Inventory and route profile enrichments through
   the same redaction policy in author/member/manager, discussion, mention/search
   and notification projections. Public profile results must exclude phone,
   credentials, workspace details, roles, internal lifecycle and hidden birthday
   parts. Do not add bio/avatar/status to existing projections until they apply
   the evaluator. Hidden and unset values should share a representation so
   presence does not disclose hidden data; finalize that DTO choice below.
5. **Avatar assets.** Use a dedicated private asset contract grounded in the
   repository's existing MinIO/S3 capability, only after storage/crop policy is
   approved. Return opaque asset references with viewer-gated delivery, not raw
   public object URLs. Recheck audience on every request, including public versus
   authenticated delivery, so changing an audience prevents future access.
   Keep original/cropped storage private and use appropriate no-store responses
   rather than relying on URL secrecy or frontend hiding. Define replacement/
   cleanup/rollback behavior before accepting uploads.
6. **Availability/status and birthday.** Treat manual availability as user data,
   not inferred online presence. Apply day/month and year policies independently
   when constructing responses; never serialize a hidden full date and rely on
   frontend masking. Finalize status subfields/expiry and birthday representation
   before implementing these writes.

Proposed audience persistence shape: owner + field + mode, plus Custom account
and workspace recipient rows; Contacts uses a separate directed edge table.
Explicit account grants match stable account ID; workspace grants match current
membership from the database. The existing model stores one User.workspaceId
per account; do not invent a multi-workspace membership model for this feature.

## Material decisions needed before profile mutations

| Choice                                  | Why it matters / proposed bounded direction                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public account lookup and base identity | Resolved: names/usernames are public base identity. Implement an explicit minimal public lookup/profile contract; keep phone, grants, membership, private aliases and private fields excluded. Real data publication awaits future deployment.         |
| Recipient/account/workspace discovery   | Define who can discover/select accounts or private workspaces and what minimal label is safe. A workspace audience must not imply a public roster. Do not assume all workspace slugs are public.                                                       |
| Profile lifecycle and blocking          | Decide public availability for PENDING/BANNED/DELETED accounts, and whether block relationships override visibility. Never expose the internal state itself publicly. No blocking model currently exists.                                              |
| Status audience granularity             | Decide whether availability, custom text and corner icon share one status policy or are independent; define allowed availability values, emoji/icon representation and expiry. No online-presence inference.                                           |
| Avatar storage/crop contract            | Approve dedicated private bucket/config, formats, byte/pixel limits, crop/aspect, retention/replacement and authorization of original versus rendition. Existing template storage is evidence of capability, not permission to publish profile assets. |
| Birthday representation                 | Decide whether callers write a full date or partial day/month/year and the policy for incomplete dates. Reads must independently redact year versus day/month.                                                                                         |
| Hidden-field DTO representation         | Proposed same null/absence shape for hidden and unset fields, without disclosure reasons or stored-value flags; select one stable public contract before implementation.                                                                               |

No additional provider or external integration is proposed. These decisions can
be resolved by the parent/user while independent authorized work continues.

## Verification before declaring profile items closed

- Anonymous, owner, Contact, explicit-account, workspace-member and unrelated
  viewer matrix for every field; mixed Custom union and owner-directed Contacts.
- Account moving workspace, workspace membership change, explicit grant
  persistence, revocation and policy-loading/unknown-mode failures.
- Day/month visible with year hidden and the inverse; no hidden date in JSON.
- Public response/asset leakage checks covering all identity projections, raw
  storage keys, cache behavior and unauthorized recipient discovery.
- Self allowlist/mass-assignment tests, cross-owner edits, transactional audience
  replacement, migration compatibility and unchanged authorization regressions.
- Privacy UI alignment with verified server DTOs, defaults and entry counts;
  separate independent review. No checkbox closes on DTO compilation alone.

## Next cohesive API13 picker/lookup batch (explicit user requirements)

Implement a dedicated working audience-picker endpoint, not frontend scans or documentation alone. One server query must search eligible workspaces and individual accounts together. Match public names and @username plus only the caller-owned private contact alias; individual results include actual names/username separately from that alias. Use parameterized queries and suitable indexes. Never match, expose or infer another owner’s aliases.

Return typed workspace/account results, stable IDs, expandable workspace/account context, saved selection metadata, cursors, deduplication and selected-off-page retention. Explicit workspace selection remains distinct from explicit account selection; derive indeterminate child selection without inventing global counts. A selected workspace represents current dynamic membership, never a frozen roster snapshot or denylist. Keep minimal discovery eligibility explicit and server-enforced; cross-workspace visibility is not currently established by admin permissions. Do not reuse broad admin reads or expose phone, roles, private workspace paths or unauthorized rosters.

Add integration tests for mixed results, cursor boundaries/deduplication, name/username/private-owner-alias search, cross-owner alias leakage, unauthorized workspace expansion, retained off-page selections and dynamic workspace/account grant distinctions. Public names/usernames are approved; no real account publication occurs during local implementation. Existing avatar/storage/lifecycle decisions remain separate.
