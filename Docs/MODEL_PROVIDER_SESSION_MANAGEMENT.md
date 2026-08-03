# Model Provider, Model, and Thinking-Effort Management

**Status:** source-backed management specification

**Catalog snapshot:** 3 August 2026

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

| Provider ID      | Provider                             | Selection source        | Authentication/runtime                                    |
| ---------------- | ------------------------------------ | ----------------------- | --------------------------------------------------------- |
| `openai`         | OpenAI                               | Built-in catalog        | Codex/OpenAI authentication                               |
| `amazon-bedrock` | Amazon Bedrock                       | Built-in static catalog | AWS SigV4 credentials; optional AWS profile and region    |
| `anthropic`      | Anthropic                            | Built-in static catalog | `ANTHROPIC_API_KEY`                                       |
| `deepmind`       | Google DeepMind                      | Built-in static catalog | `GEMINI_API_KEY`                                          |
| `ollama`         | Ollama                               | Local runtime discovery | An accessible Ollama server, normally `127.0.0.1:11434`   |
| `lmstudio`       | LM Studio                            | Local runtime discovery | An accessible LM Studio server, normally `127.0.0.1:1234` |
| configured ID    | Custom Responses-compatible provider | Runtime configuration   | Provider-specific configuration and credentials           |

Ollama, LM Studio, and custom providers deliberately have no fixed model table:
the available models and thinking controls are determined by the running local
server or custom provider. The session manager must query the catalog at launch
time and show only the returned values.

## Thinking-effort vocabulary

| Effort    | Meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
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

| Model ID            | Display name      |  Default | Supported efforts                                | Visibility                   |
| ------------------- | ----------------- | -------: | ------------------------------------------------ | ---------------------------- |
| `gpt-5.6-sol`       | GPT-5.6 Sol       |    `low` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Listed                       |
| `gpt-5.6-terra`     | GPT-5.6 Terra     | `medium` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` | Listed                       |
| `gpt-5.6-luna`      | GPT-5.6 Luna      | `medium` | `low`, `medium`, `high`, `xhigh`, `max`          | Listed                       |
| `gpt-5.5`           | GPT-5.5           | `medium` | `low`, `medium`, `high`, `xhigh`                 | Listed                       |
| `gpt-5.2`           | GPT-5.2           | `medium` | `low`, `medium`, `high`, `xhigh`                 | Listed                       |
| `gpt-5.4`           | GPT-5.4           | `medium` | `low`, `medium`, `high`, `xhigh`                 | Hidden but API-supported     |
| `gpt-5.4-mini`      | GPT-5.4 Mini      | `medium` | `low`, `medium`, `high`, `xhigh`                 | Hidden but API-supported     |
| `codex-auto-review` | Codex Auto Review | `medium` | `low`, `medium`, `high`, `xhigh`                 | Hidden internal review model |

Hidden models must not appear in the normal management picker. They may be used
only by an explicit, authorized system workflow.

## Amazon Bedrock catalog

Amazon Bedrock uses provider-prefixed model IDs and supports the implicit
default service tier only.

| Model ID               | Display name  |  Default | Supported efforts                       |
| ---------------------- | ------------- | -------: | --------------------------------------- |
| `openai.gpt-5.6-sol`   | GPT-5.6 Sol   |    `low` | `low`, `medium`, `high`, `xhigh`, `max` |
| `openai.gpt-5.6-terra` | GPT-5.6 Terra | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `openai.gpt-5.6-luna`  | GPT-5.6 Luna  | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `openai.gpt-5.5`       | GPT-5.5       | `medium` | `low`, `medium`, `high`, `xhigh`        |
| `openai.gpt-5.4`       | GPT-5.4       | `medium` | `low`, `medium`, `high`, `xhigh`        |

## Anthropic catalog

All Anthropic catalog models default to `high` and support the same five
efforts: `low`, `medium`, `high`, `xhigh`, and `max`.

| Model ID                    | Display name     | Default | Notes                                                                 |
| --------------------------- | ---------------- | ------: | --------------------------------------------------------------------- |
| `claude-opus-5`             | Claude Opus 5    |  `high` | Default Anthropic model; adaptive thinking                            |
| `claude-sonnet-5`           | Claude Sonnet 5  |  `high` | Balanced frontier option; adaptive thinking                           |
| `claude-fable-5`            | Claude Fable 5   |  `high` | Highest-capability long-running agent option; adaptive thinking       |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |  `high` | Mapped thinking budgets: 1K, 4K, 8K, 16K, and 32K tokens respectively |

For Haiku, the effort-to-budget mapping is `low` = 1K, `medium` = 4K,
`high` = 8K, `xhigh` = 16K, and `max` = 32K thinking tokens.

## Google DeepMind catalog

| Model ID                 | Display name           |   Default | Supported efforts                  |
| ------------------------ | ---------------------- | --------: | ---------------------------------- |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview |    `high` | `low`, `medium`, `high`            |
| `gemini-3.6-flash`       | Gemini 3.6 Flash       |  `medium` | `minimal`, `low`, `medium`, `high` |
| `gemini-3.5-flash-lite`  | Gemini 3.5 Flash-Lite  | `minimal` | `minimal`, `low`, `medium`, `high` |
| `gemma-4-31b-it`         | Gemma 4 31B IT         |    `high` | `minimal`, `high`                  |
| `gemma-4-26b-a4b-it`     | Gemma 4 26B A4B IT     |    `high` | `minimal`, `high`                  |

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
