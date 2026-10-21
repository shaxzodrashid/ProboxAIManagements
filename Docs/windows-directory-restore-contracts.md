# Bounded Windows native directory restore — 20 October 2026

This extends the existing FILE03 durable restore/expiry coordinator without
changing regular-file recovery, authorization, retention, schema or grants. It
does not close portable FILE03 or establish external-writer containment or
power-loss durability. All runtime tests use synthetic local trees and profile_test.

## Native support and safe admission

The production adapter invokes only the installed OS runtime at
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, with NoProfile,
NonInteractive, NoLogo and windowsHide. There is no PATH/configurable executable,
alternate runtime, package installation, Add-Type/native compilation, execution
policy bypass, credential or security-setting change. If this exact supported
runtime is unavailable, preparation returns FILE_RESTORE_UNSUPPORTED409.

The helper verifies Windows PowerShell5.1, .NET Framework4, a64-bit process,
Win32NT and existing FullLanguage mode. It never changes LanguageMode. Actual
verified runtime is recorded in `artifacts/directory-restore-runtime.json`.
Both source and destination must be ordinary absolute drive paths, under the same
drive root, on a ready fixed NTFS volume. UNC/network/removable/unverified file
systems, device/extended paths, alternate data streams and paths of248 or more
UTF-16 code units are rejected. The conservative classic .NET directory path bound
is intentional; no long-path setting is changed. Normalization-changing paths,
trailing-dot/space names and DOS device aliases are rejected rather than silently
retargeted; source-tree entry names are checked too. Runtime-incompatible long
descendants also fail preparation. Same-path/ancestor/descendant
moves are rejected. The source must be a real directory and the destination's
parent must exist as a real directory. Source/target ancestors, the source tree
and an existing destination must have no reparse attributes, including junctions.
Existing project path-policy errors remain unchanged and may reject earlier.

Preparation performs read-only checks before any durable claim. The move helper
repeats validation after claim. These checks do not freeze paths against external
writers. The collision guarantee comes exclusively from one native directory move.

The installed .NET Framework Windows implementation of Directory.Move calls
Win32 MoveFile, with no replacement or cross-volume copy flags. MoveFile requires
the directory destination not to exist and requires the same volume. References:
[Microsoft .NET Framework source](https://raw.githubusercontent.com/microsoft/referencesource/main/mscorlib/system/io/directory.cs)
and [Microsoft MoveFile contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefile).
There is no existence-check-then-rename guarantee, Node fs.rename, directory merge,
recursive-copy fallback, replacement flag, delayed move or cross-volume fallback.
Occupied empty/nonempty directories and regular files are preserved.

## Child protocol and outcomes

Paths are supplied only as ASCII-escaped JSON on stdin, never interpolated into
PowerShell code, a shell command, wildcard/provider path or argument expression.
The script uses literal System.IO paths. Unicode, quotes, backticks and shell
punctuation are tested as data. A fixed tiny JSON response carries only protocol
and outcome. Raw stdout/stderr, system errors and absolute paths never enter the
API error envelope. Helpers have a15-second timeout and4096-byte output limit;
timeout/abort/error/malformed reply never acknowledges a completed move.

PREPARE must return READY. Missing runtime, failed capability/safety checks or an
unavailable preparation response returns unsupported409 with no claim or filesystem
mutation. After claim, MOVE must return MOVED. Only exact native MoveFile HRESULTs
for ERROR_ALREADY_EXISTS183 / ERROR_FILE_EXISTS80, caught around Directory.Move,
produce COLLISION. That proves no move by this operation; the existing coordinator
records REJECTED/FILE_RESTORE_COLLISION409 and releases the claim for a later
deliberate restore. A precheck of destination existence never manufactures collision.

Any postclaim helper failure, validation change, access/sharing error, process
interruption, missing acknowledgement or unrecognized outcome remains uncertain:
FILE_TRASH_OUTCOME_UNKNOWN503 and retained STARTED/UNKNOWN claim. There is no
automatic retry, timeout release, reclassification by later pathname inspection,
alternate helper, or destructive reconciliation.

## Journal, proof and retention

Existing current permission/resource/lifecycle checks and path resolution in
ProjectsService are unchanged. Restore and expiry still compete on the same
durable recoveryToken and retention eligibility, checked after the row lock.
The claim plus STARTED record commits before native MOVE. Source identity and
whole-tree content evidence persist before execution. A successful move consumes
the private source name; target root identity and complete tree hash must match
the evidence before the item/execution atomically become RESTORED.

Proof mismatch, completion rollback or lost acknowledgement never deletes or moves
back either path. A committed RESTORED outcome can survive a lost reply; a normal
retry rereads that terminal state and returns historical success without touching
a replacement source/live name. If completion was not confirmed, the durable
claim blocks both another restore and ordinary expiry, even with retention changes.
No missing-source heuristic releases it. Existing regular-file fs.link handling
still retains its private alias; the new directory path does not change that.

No new migration, default grant, retention/purge authority or production rollout
is introduced. Existing legacy lease/PURGE_FAILED restrictions remain. Only
upgraded workers participate in the durable claims; mixed old-writer deployment
still needs coordinated cutover outside this task.

## Verification and limits

The native suite covers empty/nonempty moves, occupied empty/nonempty directory
and file destinations, a destination arriving after preparation, two independent
helpers racing one destination, literal Unicode/punctuation, source/child/target/
ancestor junctions, actual different C:/D: NTFS volumes, unsupported/aliased path forms,
and a real aborted helper. Persistence/HTTP cases cover nonempty restore and
historical retry, collision claim release, separate-client claims, restore/expiry
competition, lost claim/completion/helper acknowledgements, completion rollback,
identity/hash mismatch, real exclusive file locking, and unsupported preparation
without claim. Existing regular-file, safe-error, DTO and authorization regressions
run alongside these. Exact final results/hashes are in
`directory-restore-verification-20261020.json`.

The ordinary focused run passed112 tests /5 suites with zero failures/skips in
114.791 seconds. The final resource-bounded complete regression passed1,847 tests
/95 suites with zero failures/skips in613.418 seconds. Whole-repository verification
initially encountered actual memory pressure:
only1 MB free RAM was observed while the owned default Jest process held2081 MB
private memory. That incomplete run is retained as failure/diagnostic evidence,
not a passing regression. Unchanged Profile suites subsequently passed38 tests /2
suites with their default assertions and test budgets. A serial lower-memory full
attempt then passed1845/1847 assertions, with the expanded native HTTP case exceeding
its old5-second Jest budget and a following connection refusal. That attempt is
also retained. Final verification uses the installed ts-jest isolated compilation,
one128 MB-recycled serial test worker and a30-second Jest-only test budget; strict
whole-project typecheck/build are separate checks. No assertions, source,
15-second helper limit, application/database timeout or live setting is changed
for this runner adjustment. The isolated configuration is a temporary CLI override,
not a repository config change. Final complete counts are recorded in the handoff.

An exclusive child handle is tested after evidence/claim admission; either native
move failure or postmove proof failure must retain UNKNOWN and the bytes. The test
does not claim that locking one file always prevents a directory rename on every
Windows filesystem. Source/ancestor replacement, open-descriptor writes and other
uncontrolled writers remain outside containment. Postproof detects mismatches but
cannot freeze a checked pathname. No power-loss, fsync, distributed filesystem,
Linux/macOS directory support, private-alias reclamation or automatic uncertain
recovery is claimed. Unsupported platforms remain explicit safe rejections.

Earlier article draft/review source, its settled voting rules, and the pending
published-tree policy decisions are preserved. No article integration, actual
publication, frontend, presentation, agent, Postman, upload, paid/provider call,
credential, commit/push/deployment or live permission/security change is included.
