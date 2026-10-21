# Provisional command disclosure — 17 October 2026

The user provisionally approved strict safe-only disclosure to already authorized
execution managers. This policy is revisitable. It is not approval for arbitrary
terminal content, redaction-and-show, wider access or new archive retention.

## Verified provider boundary

The installed Codex package is 0.163.0. Its matching
[exec event schema](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec/src/exec_events.rs)
defines command, aggregated output, optional signed 32-bit exit code and status.
The matching
[JSONL processor](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
passes command text through and defaults missing aggregated output to an empty
string. Consequently an empty string does not establish that no output occurred.
There are no separately verified stdout/stderr channels in this contract. These
facts were checked against source, without running a paid provider session.

## Public projection

New command item events persist projection version 3. The existing item ID, type
and status remain; `omitted: true` and `TOOL_DETAILS_EXCLUDED` continue to describe
the excluded raw details. `data.commandDetails` adds this bounded subset:

| Field                  | Contract                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `policy`               | `STRICT_ALLOWLIST_V1`                                                                                             |
| `provisional`          | `true`; policy can be revised                                                                                     |
| `commandLabel`         | Exact generic allowlisted string or null                                                                          |
| `commandState`         | `ALLOWLISTED` or `OMITTED`                                                                                        |
| `exitCode`             | Signed 32-bit integer only on explicit `item.completed` with provider status `completed`/`failed`; otherwise null |
| `outputState`          | `OMITTED`                                                                                                         |
| `outputOmissionReason` | `UNVERIFIED_CONTENT`                                                                                              |
| `runCompletion`        | `USE_SERVER_STATE`                                                                                                |

The complete current label allowlist is `pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `git status --short`, `git diff --check`. Matching uses the complete
string, with no trimming, argument parsing, shell unwrapping, path matching or
redaction fallback. Matching configured secret values also suppresses a label.
This is a disclosure rule, not permission to execute those commands or proof that
a script is harmless. Wrapped commands commonly emitted by providers are omitted.

All nonempty output and empty/missing output remain omitted. No output text,
cwd, environment, arguments, raw JSONL, reasoning, tool results or raw archives
are added. An exit code is item-level provider metadata, not authoritative session
success; completion still comes from server state. No progress/delta semantics
are invented for command output.

## Persistence, replay and access

Projection happens before durable session-event insertion. New rows contain only
the safe subset; existing private archive behavior is unchanged. Readback rebuilds
tool payloads, revalidates v3 labels/codes and drops unknown fields. Old or unknown
projection versions never gain command disclosure from historical raw data.
Historical omission is not an empty command/output. REST history and SSE use the
same readback projection and existing sequence, pagination and reconnect rules.

Existing workspace, assigned-manager, `sessions.read`, lifecycle and stream
reauthorization checks remain in force. No role, project grant or `tasks.read-all`
capability acquires access to another manager's execution session. No schema or
data migration is required: the existing integer projection version accepts 3.
Old application versions omit v3 details conservatively on replay, so rollback
does not require rewriting rows. No historical archive backfill is performed.

## UI handoff and remaining scope

Display an allowlisted label when present and an explicit omitted state otherwise.
Treat null exit codes as unavailable, and never turn a zero code into session
success. Omitted output must not look like an empty successful terminal. Keep the
policy marked provisional in the integration contract; no user decision is made
permanent by this implementation.

The narrow command-metadata/backend disclosure contract is implemented. SESSION07
as a whole remains partial: useful nonempty terminal output, richer tool/file/diff
activity and frontend wiring are not established by this batch. Nonempty output
requires independently verified structured normalization or a subsequently
approved policy; regex/secret redaction alone is not sufficient. No frontend,
Figma, shared checklist or published Postman collection was updated. The published
Postman snapshot predates this additive local contract and needs a later refresh.

## Local verification

On 17 October, all 1,068 tests across 56 suites passed with
`PROFILE_TEST_DATABASE_URL` pointing only to isolated `127.0.0.1:55439/profile_test`.
The 83-case session HTTP suite covers durable v3 persistence without raw output,
REST/live SSE/reconnect equality, grant loss, existing assignment/workspace checks
and OpenAPI references. Projection tests cover exact matching, shell/argument
rejection, malformed codes, nonterminal events, configured secrets, historical
omissions and poisoned persisted payloads. Lint, typecheck, format, build and
`git diff --check` also passed. Expected injected-failure logs are regression
fixtures, not provider or production calls.

This batch changes exactly these files (other pre-existing dirty work is retained):

- `src/sessions/command-disclosure.ts`
- `src/sessions/safe-session-event.ts`
- `src/sessions/durable-session-events.ts`
- `src/sessions/dto.ts`
- `test/safe-session-event.spec.ts`
- `test/session-deletion.http.spec.ts`
- `Docs/session-command-disclosure-contracts.md`
- `Docs/session-ui-event-catalogue.md`
- `Docs/backend-ui-handoff.md` (additive section; prior publication notes retained)

The patch remains uncommitted on `dev` at base
`13f4b6f18a6a2bb310ec79f41d99ce4a12e0db90`. No push, deployment, production
migration, shared checklist write or access change was performed.
