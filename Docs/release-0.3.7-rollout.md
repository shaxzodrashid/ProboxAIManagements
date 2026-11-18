# Backend 0.3.7 rollout

Prepared on 18 November 2026 from v0.3.6 at
`5d87e850460c95e511b38e86f9aa4542f23e7048`. API compatibility stays on
`/api/v1`. The candidate adds session activity snapshots, Telegram session
tracking and browser access to existing workspace APIs.

## Database, preparation and activation

- Apply the 55th migration, `20261118000000_telegram_session_tracker`. It adds
  the nullable `TelegramSession.trackerMessageId` column. Existing bindings open
  without a tracker and do not need a backfill. Use Prisma migrate deploy.
- Run release metadata, lint, types, build and deployment script checks. Run
  the full regression suite and compare the migrated schema with the checked-in
  Prisma schema against an isolated PostgreSQL fixture.
- Verify remote main, the release commit and the immutable annotated
  `v0.3.7` tag before using the [app2 deployment wrapper](deployment-app2.md).
  Drain active coding turns before a restart and preserve the current release
  and ordered service environment files.
- Expect `Deployment healthy: 0.3.7`. Verify the running process, public OpenAPI
  `info.version`, readiness and the migration ledger. Test the browser routes
  through the frontend proxy with a signed-in account.

## Sessions and the Codex runner

Authorized managers can read bounded tool snapshots in session history and SSE.
Live readers wake after the event commits and resume from persisted sequences
after reconnect. Verify command and assistant snapshots, history replay and
denied access from a different manager. The frontend should use the stored
execution settings and replace snapshots using the associated item identifier.
See the [session activity contract](session-command-disclosure-contracts.md).

The default `PROBOXAI_RUNNER_TRANSPORT=exec` preserves the existing JSONL runner.
To activate live provider deltas on app2, first verify the Codex binary used by
the service can initialize app-server and start and resume threads with the
saved provider, model, sandbox and effort. Set
`PROBOXAI_RUNNER_TRANSPORT=app-server` and verify a controlled turn and follow-up.
Check command output before completion, MCP progress, file diffs, image previews,
interruption and reconnect. The available events depend on the Codex build.
Revert the setting to `exec` if app-server fails acceptance. A failed app-server
turn requires reconciliation before a fresh execution.

## Telegram

Final answers use MarkdownV2 with a plain-text fallback for formatting errors.
To activate widgets, register `widget_query` alongside `message` and
`callback_query` on the existing webhook, preserving its secret and pending
updates, then set `TELEGRAM_WIDGETS_ENABLED=true`. Keep a single Telegram worker.
Test a linked private chat with a supported client. Check `/sessions`,
`/status`, tracker refresh during a turn and the separate final reply to the
tracker. The default is text navigation. Setting the flag to `false` restores
text navigation and stops new widget sends.

## Browser proxy

| Method | Route after `/api/v1/browser`                             |
| ------ | --------------------------------------------------------- |
| GET    | `/users/me/profile/edit`                                  |
| PUT    | `/users/me/profile/changes`                               |
| GET    | `/users/me/profile/operations/:operationId`               |
| GET    | `/users/me/avatar-uploads/:uploadId/content`              |
| GET    | `/projects/:id/files`                                     |
| GET    | `/projects/:id/article-tree`                              |
| GET    | `/projects/:id/article-documents/:documentId/publication` |

The same-origin proxy forwards the caller's browser-session identity through the
existing resource authorization checks. Profile saves require CSRF validation.
Article trees add `documents` with published document IDs and titles. Check
authorized reads, profile operation receipts and denial for a cross-project
caller. These routes support directory reading and published Spaces browsing.

## Rollback

Rollback to the previous runtime can retain the nullable tracker column. Runtime
rollback leaves schema and data changes in place. Confirm health and version
after rollback, restore the previous webhook update types if required, and
coordinate the frontend fallback for profile editing, Files and Spaces. v0.3.6
uses the legacy event projection and omits the new tool snapshots on readback.
