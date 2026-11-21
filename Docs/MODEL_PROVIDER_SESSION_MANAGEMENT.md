# Model Provider, Model, and Thinking-Effort Management

## Manage the runtime catalog

ProboxAI stores the installation-wide model registry in PostgreSQL. Its management API publishes the same versioned JSON file that the backend and the Codex fork read. OpenAI, Anthropic, and Google DeepMind accept new sessions. The fork keeps the Bedrock providers disabled for new sessions.

Apply the Prisma migrations and run the updated backend with the updated CLI. Set `PROBOXAI_MODEL_CATALOG_ADMIN_IDS` to a comma-separated list of operator user IDs. Each operator also needs `settings.manage` and an access token. The backend creates `~/.proboxai/provider-models.json` under its service account, or uses the absolute path in `CODEX_PROVIDER_CATALOG`. Both runner transports pass that path to Codex. A standalone CLI can read the same file by setting that variable. All backend instances and runners serving the same installation should share this path on a filesystem supporting atomic rename. Keep it outside user-editable project directories.

| Operation                                                             | Route under `/api/v1`                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| List every configured model for a provider, including retired entries | `GET /admin/model-catalog/providers/:providerId/models`       |
| Add and publish a model                                               | `POST /admin/model-catalog/providers/:providerId/models`      |
| Update and publish a model                                            | `PATCH /admin/model-catalog/providers/:providerId/models/:id` |
| Read eligible models, defaults and effort names for session creation  | `GET /sessions/model-catalog`                                 |

For example, POST the following body to the DeepMind management route, substituting the model ID and effort names accepted by your provider account.

```json
{
  "id": "example-model",
  "displayName": "Example Model",
  "supportedReasoningEfforts": ["low", "focused"],
  "defaultReasoningEffort": "focused",
  "maxOutputTokens": 65536
}
```

To add an effort, PATCH the model with the complete new `supportedReasoningEfforts` array. You can change the default in the same request. Native Gemini sends the selected value as `thinking_level`. Native Anthropic uses adaptive thinking and sends the value as `output_config.effort`. For a manual-budget Anthropic model, supply `thinkingBudgets` with one integer per effort, each at least 1024 and below `maxOutputTokens`. OpenAI retains the fork's existing wire aliases for its special effort modes.

`isActive` controls administrative activation. `isAvailable` records operator-declared availability. Both default to true. Set `sunsetAt` to an ISO timestamp with an explicit timezone to retire a model automatically, or to null to cancel the schedule. Eligibility is evaluated on catalog reads and on new inference requests, including resumed sessions. A stream already in progress can finish. Saved preferences and historical session selections remain available for inspection. The eligible model with the lowest `priority` is the provider default. Priorities can be negative. Equal priorities sort by model ID. The session picker omits providers with no eligible models.

A successful mutation has committed to PostgreSQL and published the file. A publication failure returns HTTP 503. Read the management entry to check the stored change. The service reconciles the file from the database at startup and every 30 seconds. A duplicate POST returns 409. The initial catalog is seeded once into an empty registry. Provider credentials, account entitlements and upstream support must be configured separately.

## Browser rollout and access checks

Deploy backend **0.3.9 or later** before enabling the matching frontend. Use a
browser-enabled backend and keep the existing operator allowlist and role grants.
From the backend source or release directory, verify the frontend's API origin:

```bash
node scripts/verify-browser-catalog-gateway.mjs https://agent.probox.uz 0.3.9
```

The probe checks the running OpenAPI schema and the concrete cookie-gateway
routes without credentials or writes. The updated app2 deployment wrapper also
runs it against the candidate on loopback when `BROWSER_SESSIONS_ENABLED=true`.
Install the reviewed `deploy.sh` into the operator directory before cutover as
described in the [app2 runbook](deployment-app2.md).

Sign in through the same frontend used by the operator and open **Settings →
Installation → Model Catalog**. Confirm the model list loads. An older gateway
omits `canManageModelCatalog`, while a supported gateway reports `false` for an
account missing either the workspace permission or the installation allowlist
entry. A supported gateway returns `true` when both checks pass. Verify a
non-operator cannot open the catalog. This read-only acceptance complements the
anonymous deployment probe.

Model list responses include a per-record `revision`. Send that value in a
quoted `If-Match` header on PATCH to detect a concurrent edit. A mismatch returns
409 before the write. The header is optional for existing clients.

An assigned manager with `sessions.manage` can replace an ineligible choice on
an idle session with `PUT /sessions/:id/model-selection`. Send the previously
read `expected` object and the replacement `providerId`, `model`, and
`reasoningEffort`. The server checks the selection under the session lock,
records the old and new choices, and preserves the thread and prior turns.
Repeating the already applied replacement on an idle session returns its
effective selection.

<details>
<summary>Historical implementation and September 2026 catalog snapshot</summary>

**Status:** source-backed management specification

**Catalog snapshot:** 27 September 2026

Verified against our custom Codex checkout at `bd9b59ec80f39d19098fb36dddb9d40b7564b973`:
`codex-rs/models-manager/models.json` and the Anthropic, DeepMind and Bedrock
catalogs under `codex-rs/model-provider/src`. The official OpenAI-only catalog
is not the source of truth for this fork. Existing selections remain stored;
new OpenAI sessions default to `gpt-6-sol` and new Anthropic sessions to
`claude-opus-5-5`. Telegram uses the same managed catalog as the API.

## Purpose

This document defines how ProboxAI sessions select a model provider, a model,
and a thinking effort while retaining the existing headless `proboxai exec`
JSONL contract. It also records the model catalog compiled into the current
ProboxAI/Codex source tree.

The catalog is a selection and validation source, not an entitlement promise.
A provider, model, or effort is available to an operator only when its
credential or local runtime is configured and the provider reports it as
available at session-start time.

## Current implementation status

`POST /sessions` accepts optional `providerId`, `model`, and
`reasoningEffort`. Before a session is created, ProboxAI resolves those fields
against its managed catalog, applies the model default only when the caller
omits a value, and rejects unsupported provider/model/effort combinations.

`GET /sessions/model-catalog` gives clients the exact picker data, including
each model's `supportedReasoningEfforts` and `defaultReasoningEffort`.

The database retains the requested and effective provider/model/effort plus the
catalog snapshot used for validation. The runner starts `proboxai exec --json`
without a shell and forwards `model_provider` and `model_reasoning_effort` as
TOML configuration overrides.

`outputSchema` and live discovery for Ollama, LM Studio, and configured custom
providers are intentionally not implemented yet. They must not be sent to the
production create-session endpoint; strict request validation rejects them.
The built-in catalog is a source-backed snapshot, so operators must refresh it
when the installed Codex version or provider availability changes.

## Provider inventory

| Provider ID              | Provider                             | Selection source                   | Authentication/runtime                                    |
| ------------------------ | ------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| `openai`                 | OpenAI                               | Built-in catalog                   | Codex/OpenAI authentication                               |
| `amazon-bedrock`         | Amazon Bedrock                       | Built-in static catalog            | AWS SigV4 credentials; optional AWS profile and region    |
| `amazon-bedrock-runtime` | Amazon Bedrock Runtime               | Built-in global/US routing catalog | AWS SigV4 credentials                                     |
| `anthropic`              | Anthropic                            | Built-in static catalog            | `ANTHROPIC_API_KEY`                                       |
| `deepmind`               | Google DeepMind                      | Built-in static catalog            | `GEMINI_API_KEY`                                          |
| `ollama`                 | Ollama                               | Local runtime discovery            | An accessible Ollama server, normally `127.0.0.1:11434`   |
| `lmstudio`               | LM Studio                            | Local runtime discovery            | An accessible LM Studio server, normally `127.0.0.1:1234` |
| configured ID            | Custom Responses-compatible provider | Runtime configuration              | Provider-specific configuration and credentials           |

Ollama, LM Studio, and custom providers deliberately have no fixed model table:
the available models and thinking controls are determined by the running local
server or custom provider. The session manager must query the catalog at launch
time and show only the returned values.

## Thinking-effort vocabulary

| Effort    | Meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `none`    | No reasoning; supported by GPT-6 Sol/Luna and their Bedrock variants                       |
| `minimal` | Thinking disabled or minimized where the selected model supports it                        |
| `low`     | Lowest supported latency and token use                                                     |
| `medium`  | Balanced latency, cost, and reasoning depth                                                |
| `high`    | Deeper reasoning for complex work                                                          |
| `xhigh`   | Extended reasoning for difficult long-horizon work                                         |
| `max`     | Highest provider-supported reasoning budget                                                |
| `ultra`   | Maximum reasoning with automatic task delegation; available only on selected OpenAI models |

The effort values are model-specific. A request is invalid unless the requested
effort appears in the selected model's `supportedReasoningEfforts` list.

## OpenAI catalog

| Model ID            | Display name      |  Default | Supported efforts                                        | Visibility                   |
| ------------------- | ----------------- | -------: | -------------------------------------------------------- | ---------------------------- |
| `gpt-6-astra`       | GPT-6 Astra       |    `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra`         | Listed                       |
| `gpt-6-sol`         | GPT-6 Sol         | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Listed; provider default     |
| `gpt-6-luna`        | GPT-6 Luna        | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, `max`          | Listed                       |
| `gpt-5.6-sol`       | GPT-5.6 Sol       |    `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra`         | Listed                       |
| `gpt-5.6-terra`     | GPT-5.6 Terra     | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra`         | Listed                       |
| `gpt-5.6-luna`      | GPT-5.6 Luna      | `medium` | `low`, `medium`, `high`, `xhigh`, `max`                  | Listed                       |
| `gpt-5.5`           | GPT-5.5           | `medium` | `low`, `medium`, `high`, `xhigh`                         | Listed                       |
| `gpt-5.2`           | GPT-5.2           | `medium` | `low`, `medium`, `high`, `xhigh`                         | Listed                       |
| `gpt-5.4`           | GPT-5.4           | `medium` | `low`, `medium`, `high`, `xhigh`                         | Hidden but API-supported     |
| `codex-auto-review` | Codex Auto Review | `medium` | `low`, `medium`, `high`, `xhigh`, `max`                  | Hidden internal review model |

Hidden models must not appear in the normal management picker. They may be used
only by an explicit, authorized system workflow.

## Amazon Bedrock catalog

Amazon Bedrock uses provider-prefixed model IDs and supports the implicit
default service tier only.

| Model ID               | Display name  |  Default | Supported efforts                               |
| ---------------------- | ------------- | -------: | ----------------------------------------------- |
| `openai.gpt-6-sol`     | GPT-6 Sol     | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `openai.gpt-6-astra`   | GPT-6 Astra   |    `low` | `low`, `medium`, `high`, `xhigh`, `max`         |
| `openai.gpt-6-luna`    | GPT-6 Luna    | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `openai.gpt-5.6-sol`   | GPT-5.6 Sol   |    `low` | `low`, `medium`, `high`, `xhigh`, `max`         |
| `openai.gpt-5.6-terra` | GPT-5.6 Terra | `medium` | `low`, `medium`, `high`, `xhigh`, `max`         |
| `openai.gpt-5.6-luna`  | GPT-5.6 Luna  | `medium` | `low`, `medium`, `high`, `xhigh`, `max`         |
| `openai.gpt-5.5`       | GPT-5.5       | `medium` | `low`, `medium`, `high`, `xhigh`                |
| `openai.gpt-5.4`       | GPT-5.4       | `medium` | `low`, `medium`, `high`, `xhigh`                |

The separate `amazon-bedrock-runtime` provider accepts the six GPT-6 and
GPT-5.6 models above prefixed with `global.` or `us.` (for example,
`global.openai.gpt-6-sol`). Efforts and defaults match their Mantle variants;
`ultra` is unavailable on either Bedrock endpoint. Runtime defaults to
`global.openai.gpt-6-sol`, while `amazon-bedrock` defaults to `openai.gpt-6-sol`.

## Anthropic catalog

Anthropic models default to `high`, except Opus 5.5 (`medium`), and support the same five
efforts: `low`, `medium`, `high`, `xhigh`, and `max`.

| Model ID                    | Display name                    |  Default | Notes                                                                 |
| --------------------------- | ------------------------------- | -------: | --------------------------------------------------------------------- |
| `claude-opus-5-5`           | Claude Opus 5.5                 | `medium` | Default Anthropic model; adaptive thinking                            |
| `claude-fable-5-1`          | Claude Fable 5.1                |   `high` | Adaptive thinking                                                     |
| `claude-mythos-5-1`         | Claude Mythos 5.1 (invite only) |   `high` | Requires an Anthropic invitation                                      |
| `claude-opus-5`             | Claude Opus 5                   |   `high` | Previous generation; adaptive thinking                                |
| `claude-sonnet-5`           | Claude Sonnet 5                 |   `high` | Balanced frontier option; adaptive thinking                           |
| `claude-fable-5`            | Claude Fable 5                  |   `high` | Highest-capability long-running agent option; adaptive thinking       |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5                |   `high` | Mapped thinking budgets: 1K, 4K, 8K, 16K, and 32K tokens respectively |

For Haiku, the effort-to-budget mapping is `low` = 1K, `medium` = 4K,
`high` = 8K, `xhigh` = 16K, and `max` = 32K thinking tokens.

## Google DeepMind catalog

| Model ID                 | Display name           |   Default | Supported efforts                      |
| ------------------------ | ---------------------- | --------: | -------------------------------------- |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview |    `high` | `low`, `medium`, `high`                |
| `gemini-3.8-flash`       | Gemini 3.8 Flash       |  `medium` | `low`, `medium`, `high` (no `minimal`) |
| `gemini-3.6-flash`       | Gemini 3.6 Flash       |  `medium` | `minimal`, `low`, `medium`, `high`     |
| `gemini-3.5-flash-lite`  | Gemini 3.5 Flash-Lite  | `minimal` | `minimal`, `low`, `medium`, `high`     |
| `gemma-4-31b-it`         | Gemma 4 31B IT         |    `high` | `minimal`, `high`                      |
| `gemma-4-26b-a4b-it`     | Gemma 4 26B A4B IT     |    `high` | `minimal`, `high`                      |

Provider responses are authoritative. In particular, an effort advertised by
documentation but rejected by the active Gemini endpoint must be removed from
the picker until the live catalog confirms support.

## Required session-management contract

The future create-session request must add the following optional fields:

```json
{
  "providerId": "anthropic",
  "model": "claude-sonnet-5",
  "reasoningEffort": "high",
  "outputSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

The manager must:

1. Resolve the provider from the configured provider registry.
2. Query `model/list` for that provider, including hidden models only for
   authorized system flows.
3. Confirm that the selected model is present and that the chosen effort is
   present in its supported-effort list. If omitted, use the catalog default.
4. Persist both requested and effective provider, model, effort, service tier,
   and catalog version on the session before spawning the process.
5. Reject the request with a validation error; never silently substitute a
   different provider, model, or effort.

The app-server calls used by the control plane are:

```json
{
  "method": "model/list",
  "id": 1,
  "params": { "modelProvider": "anthropic", "includeHidden": false }
}
```

The response contains each model's `model`, `supportedReasoningEfforts`, and
`defaultReasoningEffort`. `modelProvider/capabilities/read` supplies the active
provider's tool capabilities, but does not replace per-model effort validation.

## Headless runner contract

After validation, the backend must spawn an argument array, never a shell
string. This retains JSONL stdout as the audit stream and keeps credentials out
of prompts and arguments.

```ts
[
  "exec",
  "--json",
  "--sandbox",
  sandbox,
  "-C",
  cwd,
  "-c",
  `model_provider="${providerId}"`,
  "--model",
  model,
  "-c",
  `model_reasoning_effort="${reasoningEffort}"`,
  "--output-schema",
  outputSchemaPath,
  "--output-last-message",
  finalOutputPath,
  prompt,
];
```

`--json` emits JSONL, not one final JSON document. Persist every stdout frame,
stderr, and the final workspace diff. When an output schema is supplied, parse
the final `item.completed` event whose item type is `agent_message`; its `text`
value is the JSON string that must satisfy the schema. The final-message file is
the convenient immutable output artifact, not a replacement for the JSONL
audit trail.

## Persistence and audit requirements

Add immutable session fields for `providerId`, `requestedModel`,
`effectiveModel`, `requestedReasoningEffort`, `effectiveReasoningEffort`,
`outputSchema`, and `catalogSnapshot`. Store final structured output as a
session artifact. Preserve the existing sequenced event/hash chain, token
usage, stderr archive, and final binary Git diff.

Provider secrets stay in the service environment or provider credential store.
The backend must pass only the narrowed safe environment to the child process;
never return secrets in the API, archives, event stream, command arguments, or
model-visible context.

## Operational rules

- Use the absolute `PROBOXAI_BIN` path in production because the runner uses
  `spawn(..., { shell: false })`.
- Validate `cwd` against the configured allowed workspace roots before starting
  a session.
- Treat `turn.failed`, non-zero process exit, malformed JSONL, and schema
  validation failure as terminal failures with preserved evidence.
- Do not retain or claim to retain hidden chain-of-thought. Retain only
  observable JSONL events, returned reasoning summaries where available, usage,
  stderr, diffs, and structured final outputs.
- Refresh the runtime catalog whenever provider configuration, credentials, or
  executable version changes; do not treat this source snapshot as permanent.

## Source of truth

The catalog in this document is compiled from the current Codex source:

- `codex-rs/model-provider-info/src/lib.rs` for built-in providers and IDs.
- `codex-rs/models-manager/models.json` for OpenAI models and effort options.
- `codex-rs/model-provider/src/amazon_bedrock/catalog.rs` for Bedrock models.
- `codex-rs/model-provider/src/anthropic/catalog.rs` for Anthropic models.
- `codex-rs/model-provider/src/deepmind/catalog.rs` for DeepMind and Gemma models.
- `codex-rs/app-server-protocol/src/protocol/v2/model.rs` for the runtime
  catalog response contract.

The current ProboxAI implementation boundaries are in
`src/sessions/dto.ts`, `src/sessions/sessions.service.ts`,
`src/sessions/proboxai-runner.service.ts`, and `prisma/schema.prisma`.

</details>
