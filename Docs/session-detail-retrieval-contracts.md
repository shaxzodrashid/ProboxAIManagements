# Authorized retained session detail retrieval

The approved local slice adds `GET /api/v1/sessions/:id/events/:eventId/details`.
It reads only retained database events. It never reads raw archive files, decrypts
execution input, starts an execution, calls a provider or reads current workspace
files. Existing public history/SSE and archive `STRICT_METADATA` policy remain
unchanged. Discover event IDs and ordering through the existing history routes.

Both path IDs require UUIDv4. Every request requires the current OPEN actor,
matching session/task workspace, current assigned task manager and `sessions.read`.
The service reloads those conditions inside the same RepeatableRead transaction
as its session-scoped event lookup; a stale JWT, page revision or event ID grants
no authority. There is no admin/read-all bypass. Like existing session reads,
authorization is a request snapshot, not a lock held against every concurrent
future revocation. A revocation visible before the transaction is denied.
Responses use `Cache-Control: no-store`. Recognized database availability failures
return the existing sanitized `READ_DEPENDENCY_UNAVAILABLE503`; unknown errors keep
their established error behavior.

## Projection and source evidence

`projectionVersion:1`, `policy:REDACTED_SESSION_DETAIL_V1` is a separate, allowlisted
retrieval contract. Supported retained archive envelopes have policyVersion1,
RUNNER_REPORTED source, matching event type and canonical stored hash. The adapter
stores `workspace.diff` under the public `runner.omitted` envelope; that specific
pair is supported. The hash checks storage consistency, not trusted authorship,
cryptographic authenticity or verified execution success.

The command/file schemas are grounded in the local Codex exec JSONL source,
`codex-rs/exec/src/exec_events.rs` (`CommandExecutionItem`, `FileUpdateChange`,
`FileChangeItem`, `PatchChangeKind`), and the existing ProboxAI runner adapter.
No future provider fields are inferred from names.

| Kind           | Allowed fields                                                                               | Provenance                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| COMMAND        | `command`, `aggregated_output` as `content`, terminal signed32-bit `exit_code` as `exitCode` | Runner-reported frame. Output is combined output; separate stdout/stderr is not inferred. Exit code requires item.completed plus completed/failed status.                                                    |
| FILE_CHANGES   | `changes[].path`, `changes[].kind` (add/delete/update)                                       | Reported paths and operations only. Unknown fields, patch/body/revisions are omitted. Invalid paths are null; unknown kinds are UNAVAILABLE. Paths never trigger filesystem access.                          |
| WORKSPACE_DIFF | Adapter `stage:final`, `redactionPolicy:BEST_EFFORT_V1`, `diff` as `content`                 | `FINAL_WORKSPACE_DIFF_NOT_PER_TOOL_ATTRIBUTION`. This can include preexisting/unrelated workspace modifications; it is not per-tool or verified historical file attribution. Binary diff bodies are omitted. |

Other tools, collaboration, web, standalone runner stderr/errors, hidden model
reasoning and arbitrary nested fields remain excluded. No raw payload passthrough
is used. `runCompletion:USE_SERVER_STATE` keeps runtime state separate from event
reports. Missing archive content yields LEGACY_DETAIL_UNAVAILABLE; unsupported or
inconsistent archives yield UNSUPPORTED_SCHEMA/UNVERIFIED_ARCHIVE with unavailable
source/completeness. Detail is never reconstructed from legacy public metadata.
Binary diffs yield BINARY_DIFF_OMITTED. Missing/oversized fields yield
CONTENT_UNAVAILABLE_OR_OVERSIZED. A null command/path/exit code is unavailable,
not an invented empty value. An actual empty output remains an empty string.

## Redaction, limits and continuation

Treat every returned string as untrusted plain text; render using text nodes,
never HTML, terminal escape interpretation, executable links or shell execution.
Redaction is best effort, not an exhaustive detector for arbitrary, encoded,
obfuscated or unlabeled private material. Known configured credentials (including
short values), common credential assignments/flags, JSON-style keys, URL userinfo,
Bearer tokens, common token patterns and private-key blocks are redacted. ANSI
colour sequences are removed before matching; other non-display controls are
removed before credential matching, and unknown terminal escapes make the field
unavailable. Hidden reasoning fields are excluded structurally. Whole-field redaction
occurs before paging and is repeated with current configuration on every read.
Retention also handles multiline/unterminated quoted credentials; URL matching
starts at the literal `://` delimiter so long unbroken output does not cause
repeated scheme scans or reduce protection for URL substrings in other text.

Query: `offset=0`, `limit=4096` by default; limit1–16384 UTF16 code units for text,
or at most100 changes for lists. Text input or redacted fields over1,048,576 units are omitted
whole, commands over8192 and paths over4096 units after redaction are null. Lists
over10,000 entries are unavailable. Archive verification is capped at4Mi serialized
UTF16 units and catches invalid/deep structures. These are retrieval bounds, not
content deletion or retention expiry. The database still loads one retained event
before this projection; it is not a streaming database blob API.

Responses include event/session/turn IDs, sequence/time, archive policy version,
source/completeness, kind/availability, command/exitCode/content/changes, offset,
totalUnits/units, nextOffset, truncated and projectionHash. `truncated` means this
response has a continuation, not that the source record was complete. Text offsets
are explicitly UTF16 units and may split a surrogate pair; concatenate pages before
display if that matters. Reported frames are not merged into invented snapshots.

For every continuation, pass `revision=<projectionHash>` and
`offset=<nextOffset>`. The revision binds the complete current redacted projection
to the session/event. Missing revision at nonzero offset or changed projection
returns409; restart at zero. This prevents combining pages across redaction/config
changes. Offset past available content returns400. Each page reauthorizes access.
The revision is neither an authorization token nor a frozen disclosure entitlement.

No content expiry, migration, backfill, key issuance, role/default change or external
disclosure is introduced. Long-lived records retain the existing
RETAIN_UNTIL_AUTHORIZED_DELETION policy; authorized deletion still cascades.

## Local handoff

Use history/archive event IDs, then request the new detail endpoint. Test fixtures
are isolated and synthetic; no fixture credentials or working JWT are needed in
handoff material. Focused/full evidence is in
`session-detail-verification-20261020.json` and the referenced local artifacts.

The next focused task can wire a frontend command/output/diff drawer to this
contract, rendering plain text, handling explicit unavailable states, restarting
on409 and stopping on access denial. Per-file historical reads/revisions, verified
read/write attribution, richer tool schemas and separate stderr remain outside this
slice. No whole SESSION07/SESSION08 umbrella closure is claimed. Article publication,
shared checklist trees, Postman, uploads, production operations and deployment remain
outside this task. Existing unrelated uncommitted work is preserved; no commit/push.
