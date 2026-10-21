# FILE03 restore and expiry coordination — 20 October 2026

This increment coordinates recoverable-file restore and ordinary expiry cleanup.
It does not close FILE03, change the existing 30-day deletion retention interval,
or add permanent-deletion authority. All fixtures are synthetic and local.

The later Windows directory increment is specified in
`windows-directory-restore-contracts.md` with its separate verification handoff.
The original file-only counts in the earlier JSON remain historical evidence.

## Durable admission and outcomes

An ACTIVE trash item has one nullable recoveryToken. Restore and expiry compete
for that same field using an atomic database compare-and-set. The claim and an
execution record commit together before any publication/removal call. Admission
rechecks ACTIVE, retention eligibility, absence of a recovery claim and absence of
legacy lease fields. Cleanup rechecks expiry rather than trusting its candidate
snapshot. Claim acknowledgement loss issues no filesystem operation. Claims do
not expire and neither restart nor old lease expiry permits automatic replay.

Execution states are STARTED, UNKNOWN, REJECTED, RESTORED and PURGED. Completion
updates the item and execution in one transaction. STARTED means execution may
have started, including a lost acknowledgement or crash; it is not proof that a
worker remains alive. Failed outcome persistence leaves the original STARTED
record and claim. Filesystem errors, partial removal and completion uncertainty
retain the claim. A proven native EEXIST collision records REJECTED and releases
the claim without changing retention, permitting a later deliberate restore.
Historical successful restore retries return the stored relative path and never
inspect or modify a replacement at the live path.

Legacy PURGE_FAILED rows and any legacy lease fields are review-only; cleanup no
longer retries them. Their previous partial-removal outcomes cannot be inferred
from age. PREPARED/NEEDS_REPAIR deletion items remain excluded from cleanup.

GET /projects/:id/trash/:trashId is a no-store, metadata-only outcome readback,
including terminal items and execution history. It requires the existing
projects.files.delete grant and sensitive project scope, without a READY gate.
It exposes only relative path, status, expiry, completion dates, nextAction and
allowlisted execution id/action/state/static errorCode/timestamps. It never
exposes private paths, keys, claim tokens, source identity or hashes. Unresolved
claims/legacy leases request REVIEW_OUTCOME. No automatic reconciliation or
claim-release endpoint is introduced.

## Publication and filesystem limits

Restore publishes regular files with fs.link, followed by identity/content proof
and database completion. The native hard-link operation creates one complete name
without replacing an existing file/directory; no rename, recursive copy or
fallback publication is used. Windows and Linux use this path; the local Windows
filesystem is exercised by real collision and concurrent-worker tests. Linux
runtime execution is not claimed by this Windows verification. Unsupported
filesystem failures retain an explicit unknown outcome, without fallback.
Directories now have a bounded local Windows x64 same-volume fixed NTFS path,
using the vetted installed Windows PowerShell5.1/.NET Framework4 Directory.Move
implementation and native MoveFileW no-overwrite behavior. Unsupported runtime,
volume/path and reparse cases fail closed before claim; checks are repeated in
the move helper. The native operation, not an earlier existence check, prevents
replacement of even an empty concurrent destination directory. There is no copy,
merge, replacement, alternate-runtime or Node rename fallback. Other directory
platforms remain FILE_RESTORE_UNSUPPORTED409. Existing project/path validation
errors are preserved.

For regular files, the private source name is retained after publication. It aliases
the restored inode, not an immutable backup: later content edits can affect both
names. Removing that name safely against uncontrolled private-namespace writers
cannot be proved with Node path APIs. No automatic reclamation or new retention
schedule for these terminal aliases is invented. This storage limitation is
explicit; broader private-alias reclamation needs a supported identity-bound
primitive or enforced namespace contract. Ordinary expiry never removes the
live restored name or a successful item's retained alias.

A successful native directory move consumes its private source name and retains
the complete tree at the live destination. Post-move identity/content proof and
database completion still apply. Interrupted helper, missing acknowledgement,
failed proof or failed completion leaves STARTED/UNKNOWN and its durable claim;
neither missing source nor present destination proves safe replay. No compensation
deletes, moves back, merges or overwrites either name.

No database lock excludes arbitrary shells, editors, coding sessions or escaped
children. Ancestor/source replacement and open-descriptor content mutation by
external writers remain outside the guarantee. The post-publication proof
detects mismatches and retains UNKNOWN without compensating removal. It cannot
prove that a checked pathname stays bound to that object after the check. Purge
retains its existing private-path rm semantics, coordinated only among upgraded
application workers. This increment makes no power-loss durability or enforced
external-writer exclusion claim.

## Migration and rollout

20261020030000_file_trash_recovery adds a nullable token and empty execution table,
with action/state checks, parent cascade and history index, in one transaction.
Existing rows retain their status, expiry and leases; no successful history is
fabricated. Applied only to isolated 127.0.0.1:55439/profile_test. Older application
workers bypass the claim: coordinated migration/writer cutover is required before
production use. No production migration, cleanup or deployment was performed.

Reproductions and final verification are recorded in
file-trash-recovery-verification-20261020.json. All work remains uncommitted on
dev with earlier changes preserved. Postman remains stopped.
