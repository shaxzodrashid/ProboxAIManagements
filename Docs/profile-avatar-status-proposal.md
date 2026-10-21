# Avatar and custom-status proposal — 18 October 2026

**Historical proposal:** the owner subsequently approved this feature package,
with API status input 100 and database capacity 300. See the superseding
[implementation contract](profile-media-status-contracts.md) for the implemented
scope and verification. The draft wording below records the earlier decision point.

**Draft for the owner's decision, not approved product policy or a shipped API.**
The parent has proposed existing file storage with validated images and authorized
delivery, plus short status text, one optional emoji and optional expiry. No answer
has been received. This document supplies concrete defaults and implementation
boundaries without activating them, creating credentials/buckets or changing access.

## What the current repository establishes

- [Project uploads](../src/projects/projects.service.ts) use project filesystem
  paths with project membership/lifecycle checks. Their default is 100 MiB per
  file. Their download controller returns an attachment as application/octet-stream.
  That scope and response are not a personal-avatar delivery contract.
- [Template storage](../src/configuration-templates/template-storage.service.ts)
  uses the installed S3 client with configurable MinIO endpoint/region/path style,
  a template bucket, SHA-256 metadata and put/head/get/delete. It reads existing
  credentials lazily. Automatic bucket creation is configurable; this proposal
  does not enable it. Source inspection does not verify the live bucket policy,
  storage health or available production access.
- [Upload limits](../src/storage/upload-limits.ts) already have matching effective
  interceptor/service metadata patterns. Template limits are 100 MiB/file and
  1 GiB/version, with request spooling and cleanup. They are generic-file limits,
  not image limits and should not silently become avatar defaults.
- [Template cleanup](../src/configuration-templates/template-object-cleanup.service.ts)
  retries durable jobs and checks template-file references. It knows nothing about
  avatars or staged profile assets. Avatar keys must not enter that worker without
  an asset-aware reference model; otherwise a still-used avatar could be deleted.
- There is no installed direct image decoder/normalizer or emoji-validation
  subsystem in package.json. Header/MIME/extension checks alone cannot validate,
  orient, crop or safely re-encode an image. The required local processing
  dependency is an engineering choice to verify when implementation is approved.
- AVATAR/STATUS audience records and the current viewer evaluator already exist.
  They do not implement assets or custom status. AVATAR's absent policy currently
  evaluates privately. Shared availability ignores STATUS audiences; its public
  AVAILABLE/AWAY/BUSY/null contract must remain intact.

## Recommended minimal avatar package — pending approval

| Concern             | Concrete proposed default                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage             | Reuse the existing MinIO/S3 transport conventions, with a separately configured, preprovisioned private avatar bucket. No new provider, credentials, bucket creation or ACL changes during this local work. Verify private bucket configuration before any real delivery.                                                                                                                                                        |
| Ownership           | Account-owned immutable assets, independent of selected project/workspace. An account's workspace move must not rename its image or grant a former workspace access. Store an opaque asset ID and server-owned key; accept no caller-supplied path, bucket, object URL or external fetch URL.                                                                                                                                    |
| Input               | Static JPEG or PNG, at most **5 MiB (5,242,880 bytes)**. Validate actual bytes and full decode, not declared MIME. Reject animation, malformed images and unsupported formats.                                                                                                                                                                                                                                                   |
| Decode budget       | At most **16 million pixels**, neither dimension above **8,192 pixels**. Apply limits before full allocation where the decoder supports it. Reject rather than silently accepting an over-budget upload.                                                                                                                                                                                                                         |
| Normalized output   | One square PNG, at most **512 × 512**, retaining transparency and avoiding upscaling. Strip EXIF/GPS and other original metadata; retain no downloadable original. Cap normalized output at **2 MiB**. These are new proposed limits, not inherited existing policy.                                                                                                                                                             |
| Crop                | Apply orientation before crop coordinates. Default to a centered square; accept an optional bounded square `{x,y,size}` in oriented source pixels. Validate the entire rectangle; do not silently clamp an invalid draft. Zoom is frontend crop selection, not arbitrary server transforms.                                                                                                                                      |
| Visibility          | Reuse current AVATAR audiences. Upload never publishes an image or changes its audience. Preserve private evaluation when policy is absent; no additional public-avatar default.                                                                                                                                                                                                                                                 |
| Delivery/cache      | Application endpoint rechecks current account, current asset and current viewer audience on every request. No direct bucket/public URL or long-lived signed URL. Send only normalized image bytes with correct image/png, no-store and nosniff. Missing, removed, hidden and stale asset references have the same unavailable response and no private metadata; public profile image reference is null in each unavailable case. |
| Removal/replacement | Atomically clear/switch the active pointer at final Profile Save. Subsequent authorized reads reject old references; UI clears old images and uses initials fallback. Queue reference-aware cleanup only after commit; no avatar Trash/history or original-image archive in this proposed first increment. Already delivered pixels cannot be recalled.                                                                          |

The transport choice needs the owner's direction and operational bucket review;
an existing template bucket name or MINIO_AUTO_CREATE_BUCKET setting is not proof
that a personal-photo destination is authorized or private. Project membership,
users.read, role names and knowing an object key never bypass AVATAR audiences.

Upload should stage an owner-bound immutable asset before final Save. Root Profile
Save commits its pointer, supplied audiences, covered revisions and minimal receipt
together. Cancel leaves the current image unchanged. Failed/abandoned drafts need
bounded cleanup; unknown Save outcomes first reconcile the original request ID.
Do not delete a possibly committed object after a timeout or perform remote storage
I/O inside the account transaction. The existing template staging/cleanup patterns
can inform the design, with new avatar-specific ownership/reference checks.

## Recommended custom-status package — pending approval

| Concern           | Concrete proposed default                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text              | Optional plain single-line text, at most **100 Unicode code points**, using the existing class-validator text-length convention. Trim edges; blank normalizes to null. No markup/HTML or automatic links. Reject line breaks with a field error that preserves the draft.                                                                                                                                           |
| Symbol            | One optional standardized Unicode emoji sequence, including valid flags/skin tones/ZWJ sequences. Validate one emoji grapheme against pinned supported emoji data; do not equate one code unit or any single grapheme with a valid emoji. No arbitrary icon identifier, uploaded sticker or custom-image badge in this increment.                                                                                   |
| Unit of update    | One custom-status value containing text, emoji and expiresAt. Omit the whole value to retain; null clears; a supplied object replaces the complete unit. Text-only and emoji-only values are allowed; expiry without content is invalid.                                                                                                                                                                            |
| Expiry            | **Off by default** (`expiresAt:null`). Optional explicit future RFC3339 instant with timezone/offset, normalized to UTC milliseconds. No date-only input, automatic duration or new preset list. No arbitrary 30-day cap is proposed; enforce the actual supported timestamp range.                                                                                                                                 |
| Effect of expiry  | Text and emoji expire together. Shared availability is untouched. Effective reads suppress expired custom status; expiry is not presence, lifecycle or a new human action. No public expired-value/history endpoint. Do not promise automatic physical erasure or choose a content-history retention duration without a retention contract.                                                                         |
| Concurrency/retry | Include new covered data in aggregate profile revisions and the same atomic main Save. Preserve the standalone availability revision/receipts and its existing response shapes. Exact receipt replay must succeed even after the supplied expiry passes; time-dependent validation belongs after matching prior-operation reconciliation, not before it. Never revive expired content by silently moving expiresAt. |

**One visibility choice is still necessary.** Existing code establishes that manual
availability is shared with everyone, but does not establish whether this later
custom text/emoji must also be shared. Recommended conservative package: use the
existing STATUS audience for custom text/emoji, private when absent, while leaving
availability shared. That activates STATUS for new content and therefore needs
explicit selection; it is not implied by inert legacy policy records. If the
owner intends the whole custom status to be shared, implement that selected rule
instead, without repurposing the availability field or silently publishing old data.

Expiry is an effective read-time boundary even when cleanup has not run. Separate
persisted edit state and effective display state must avoid returning expired
content publicly or resurrecting it during an unrelated Save. Content retention,
staged-upload TTL and cleanup retry timing need a concrete implementation contract
before those storage behaviors ship; they need not become new profile UI controls.

## Decisions versus engineering already determined

The owner can approve or amend two bounded packages: image/storage/crop/removal
defaults above; and text/emoji/optional-expiry defaults plus custom-status audience.
No choice is needed about mandatory last names, legacy name splitting, new phone/
username edits, automatic presence, admin profile takeover or weakening access:
existing contracts already exclude those changes.

Decoder/emoji-library selection, parameterized queries, byte validation, current
viewer evaluation, exact retry/readback, transactional asset references, sanitized
errors and focused integration tests are implementation work within an approved
contract. They do not require separate product approval for each code step.
None of these draft fields/routes is added to generated shipping OpenAPI until
implemented and verified. The completed local fix batch and its 1,073-test evidence
remain recorded in [the gap review](profile-gap-review-20261018.md).
