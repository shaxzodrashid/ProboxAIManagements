# Backend 0.3.8 rollout

Backend `0.3.8` adds operator-managed provider models and reasoning efforts to
the [0.3.7 release](release-0.3.7-rollout.md). API compatibility remains on
`/api/v1`. See the [catalog guide](MODEL_PROVIDER_SESSION_MANAGEMENT.md) for the
management API and published JSON format.

## Prepare app2

- Verify that the configured Codex executable accepts `CODEX_PROVIDER_CATALOG`.
  Use the [app2 Codex runbook](https://app.notion.com/p/41dc1b7a5bd181b4a083eb4cbd44b5da)
  to verify the candidate as the service user and smoke-test OpenAI, Anthropic
  and Gemini with app2 credentials before cutover. The version banner alone
  cannot verify file support.
- Set `PROBOXAI_MODEL_CATALOG_ADMIN_IDS` to the operator user IDs allowed to
  administer the installation-wide catalog. Each operator also needs
  `settings.manage`. An empty allowlist disables administrative access.
- Use the service account's default `~/.proboxai/provider-models.json` or set
  `CODEX_PROVIDER_CATALOG` to an absolute path. Verify that the backend can
  atomically write the file and that the runner can read it. For multiple
  instances, use the same shared path and database across instances.
- Apply `20261119000000_managed_models` through Prisma. When upgrading directly
  from `0.3.6`, also apply `20261118000000_telegram_session_tracker` in the same
  migration run. The backend seeds an empty catalog and publishes its JSON
  during startup. Check pending migrations before activating the release.

## Verify after activation

- Follow the [app2 deployment procedure](deployment-app2.md). Confirm readiness
  and public OpenAPI `info.version` of `0.3.8`.
- Check `GET /api/v1/sessions/model-catalog` and the Telegram model picker for
  OpenAI, Anthropic and Gemini. Verify the management API allows an authorized
  operator and rejects an account outside the installation allowlist.
- Check that the database rows appear in the versioned JSON. Exercise a
  controlled catalog change and confirm that a Codex turn reads the published
  model and reasoning effort. Check a resumed turn with an existing selection.
- If enabling Telegram widgets or app-server streaming for the first time,
  follow the separate acceptance checks in the [0.3.7 rollout](release-0.3.7-rollout.md).

## Rollback

Use the deployment wrapper to restore the previous backend release. Leave the
catalog table and its data in PostgreSQL. If the Codex binary also changed,
follow the Codex runbook to restore its previous selection and verify that
the restored backend and CLI can start and resume a controlled session.
