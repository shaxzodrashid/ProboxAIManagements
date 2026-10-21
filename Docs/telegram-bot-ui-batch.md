# Telegram bot navigation and truthful state copy

18 October 2026; local `dev` patch. Scope is existing verified-private-chat bot
interaction. No live Telegram message, provider session, deployment or Postman write.
Existing account/contact/OTP authentication and business operations remain intact.

## Coherent local increment

The menu groups Projects/Recent sessions, Models/Status, then New session. Existing
commands remain available. New navigation callbacks call the same existing guarded
read/preparation paths; displayed buttons never supply permission. Every callback
still receives prompt acknowledgment before durable work, and current actor/grants
are refreshed after waiting in the per-user queue.

Models now opens one editable panel listing models directly, with provider names
as secondary labels and eight choices per page. Model and reasoning changes are
drafts until Confirm; Back preserves the draft and Cancel (including `/cancel`)
discards it. Saved project/session selections and running work are unaffected. New session
uses the existing `/new` behavior: clear the selected session, retain project/model,
and wait for a new message. It does not stop another run or send a task.

Empty project/session screens keep a way back. Stale/out-of-range project-page
buttons clamp to an existing ready page; noninteger/nonfinite selectors return to
the first page. Existing ready-project filtering and execution authorization remain.

Accepted task/follow-up replies show the existing durable acceptance status, IDs
and read-only reconciliation buttons. No automatic retry button is introduced.
Unknown/server failures use generic outcome-unknown guidance, without raw upstream
5xx messages. Client validation/access messages keep their existing text and gain
navigation. Durable request IDs, Telegram update deduplication, service calls and
runner scheduling are unchanged. A new message is not promised to be a safe replay
of a previous initial start.

Stop acknowledgment explicitly says exit is not confirmed. Status now interprets
existing stopConfirmation/recoveryReason fields: STOP_UNCONFIRMED blocks follow-up,
LOCAL_EXIT_OBSERVED is local evidence only, NOT_STARTED means no recorded runner
start in that state, and unknown values never imply stop. Owner loss gets plain
wording, not arbitrary raw recovery text. Relay terminal buttons say View session;
selection does not start a follow-up. Relay ordering/cursor/retry behavior is unchanged.

## Before and after examples

| Surface                | Before                                                                              | After / buttons                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu                   | Long command list; Projects / Models only                                           | Short task flow; Projects / Recent sessions, Models / Status, New session                                                                         |
| Project chosen         | `Project: Demo. Send your task, or choose /model first.` / Choose model             | `Project selected: Demo. Send a task to request a new session… Existing sessions are not stopped.` / Choose model, Back to projects, Menu         |
| Model selection        | Provider message → model message → effort message, each selection immediately saved | One editable message: direct model choices → supported reasoning/default → Confirm or Cancel; Back to models and pagination edit the same message |
| Empty projects         | `No ready projects are available.` with empty keyboard                              | Explains project may be initializing; check app and reopen / Menu                                                                                 |
| Recent session         | `Select…to continue`                                                                | Selection does not send a task or resume work / session rows, Projects, Menu                                                                      |
| New session            | `Send a task to start…`                                                             | `New session prepared… Existing work continues; no task has been sent yet.` / Projects, Models, Menu                                              |
| Task accepted          | `Started in Demo…`                                                                  | `Task accepted · QUEUED… Acceptance is not completion… Check Status before resending.` / Check status, Recent sessions, Menu                      |
| Uncertain/server error | Raw HttpException text or generic retry wording                                     | `The result could not be confirmed… Your request may already have been accepted.` / read-only Check status, Recent sessions, Menu                 |
| Stop                   | `Interruption requested.`                                                           | `Interruption requested. This does not confirm the process has stopped…` / Check status, Recent sessions, Menu                                    |
| Unconfirmed stop       | State alone, e.g. INTERRUPTED                                                       | `Stop unconfirmed. Do not assume work stopped; follow-ups are blocked… The run owner was lost.`                                                   |
| Relay terminal reply   | Continue this session                                                               | View session / Menu; check Status before follow-up; New does not reopen the run                                                                   |

The contact-sharing and localized OTP messages are deliberately unchanged in this
batch. Telegram bot behavior is separate from the missing frontend application;
the [full UI readiness plan](ui-session-readiness-plan.md) starts at login and
tracks workspace/project/task/setup/run dependencies without inventing new semantics.

## Exact files and verification

```text
src/telegram/telegram-bot.service.ts
src/telegram/telegram-session-relay.service.ts
test/telegram-bot.spec.ts
test/telegram-relay.spec.ts
test/profile-picker.http.spec.ts
Docs/telegram-bot-ui-batch.md
Docs/ui-session-readiness-plan.md
Docs/backend-ui-handoff.md
```

The tests use mocked Telegram/project/session/catalog dependencies; file-download
regressions use temporary files only. New navigation/state tests exercise empty and
stale pages, cancel/back/new behavior, scoped reads and current permissions, callback
acknowledgment order, queued acceptance identity, sanitized5xx, and stop evidence.
Existing dedup, lost-reply, provider selection, referenced-file authorization and
relay delivery/revocation regressions remain. A read-only collaborator found the
initial status omission of stop evidence; it was corrected before final verification.
Prior navigation-batch verification: **1,195 tests /65 suites passed**. The focused
Telegram run passed35 tests in five suites; the corrected profile suite passed25
tests. Typecheck, lint, formatting, build, release and `git diff --check` pass.
All172 local API contract checks still pass; no API schema refresh or Postman write
was required. README and linked-agent assessment SHA256 hashes are unchanged.
The isolated PostgreSQL test instance is stopped after verification; its directory
is retained. No schema/migration, account, grant or provider setting was changed.

The first full run passed1,194 tests and exposed one pre-existing flaky profile
index assertion. PostgreSQL legitimately chose a covering index on the small fixture
instead of the expected expression index. The test now checks the required index's
valid/ready, nonunique `lower(id)` definition directly; existing case-variant HTTP
tests still verify lookup behavior. No runtime profile query, index or migration
changes. This independently actionable verification correction is included above.

## Editable model-panel correction

The earlier save-as-selected provider wizard is superseded. `/model` sends one
message only when no active draft exists. Models buttons and all subsequent model,
effort, pagination, Back, Confirm and Cancel actions edit the originating message.
Repeated `/model` resumes its draft. The panel shows saved settings, draft settings,
model default and only supported effort choices from ModelCatalogService. Changing
models resets effort to that model's default; no availability or entitlement claim.

Drafts expire after ten minutes, are scoped to current user/workspace/private chat
and message, and bind a nonce and revision to buttons. Old, duplicate, foreign,
expired and restarted-process buttons cannot save; a callback toast explains the
stale panel. Drafts are process-local: another replica or a restart can lose a
draft safely and requires reopening Models. This increment does not add shared
draft storage or require a migration.

Confirm revalidates the catalog and identity/current grant, then compares the three
original saved settings in one updateMany before writing only providerId, model
and reasoningEffort. Concurrent settings changes are not overwritten. Project and
session IDs are neither compared nor written. The draft closes before persistence
I/O so uncertain outcomes cannot be retried by duplicate buttons; reopen Models to
read current settings. Confirmation does not create tasks or execute turns.

Legacy provider/model/effort buttons now edit an explanatory closed screen without
saving. Edit failures never fall back to new navigation messages. Only Telegram's
400 `message is not modified` error is treated as a successful no-op; other errors
remain failures. Existing authorization, update deduplication, per-user queues,
acceptance IDs, file delivery and relay ordering are preserved.

Additional files: `src/telegram/telegram-model-panel.ts`,
`src/telegram/telegram.service.ts`, `test/telegram-model-panel.spec.ts`,
`test/telegram-edit-message.spec.ts`; bot integration/tests updated in place.
Focused verification: **43 tests /4 suites passed** with mocked external APIs.
Final frozen-source full verification: **1,213 tests /67 suites passed**.
Typecheck, lint, formatting, build, release checks, all172 API-operation contract
checks and `git diff --check` pass. The first full attempt overlapped the final
permission-guard edit and hit an unrelated Windows mkdtemp failure; both suites
pass in the subsequent unchanged-source full run. Transport tests drain the
intentional rate-limit queue timers. No live Telegram messages.

No migration was added in this correction; existing migration files and all prior
dirty work remain. README and linked-agent assessment hashes match their original
protected values. The isolated test PostgreSQL instance is stopped after testing;
its data directory remains. The BFF and initial-create-receipt proposals are
review-only and close no implementation checklist items. Parent owns checklist
status and selection of the next batch.
