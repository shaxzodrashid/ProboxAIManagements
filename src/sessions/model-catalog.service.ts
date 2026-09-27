import { BadRequestException, Injectable } from "@nestjs/common";

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface SupportedModel {
  id: string;
  displayName: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: readonly ReasoningEffort[];
}

export interface ModelProviderCatalog {
  id: string;
  displayName: string;
  defaultModel: string;
  models: readonly SupportedModel[];
}

export interface ResolvedModelSelection {
  providerId: string;
  requestedModel: string | null;
  effectiveModel: string;
  requestedReasoningEffort: ReasoningEffort | null;
  effectiveReasoningEffort: ReasoningEffort;
  catalogSnapshot: Record<string, unknown>;
}

const STANDARD_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const BALANCED_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

const PROVIDERS: readonly ModelProviderCatalog[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    defaultModel: "gpt-6-sol",
    models: [
      model("gpt-6-astra", "GPT-6 Astra", "low", [
        ...STANDARD_EFFORTS,
        "ultra",
      ]),
      model("gpt-6-sol", "GPT-6 Sol", "medium", [
        "none",
        ...STANDARD_EFFORTS,
        "ultra",
      ]),
      model("gpt-6-luna", "GPT-6 Luna", "medium", [
        "none",
        ...STANDARD_EFFORTS,
      ]),
      model("gpt-5.6-sol", "GPT-5.6 Sol", "low", [
        ...STANDARD_EFFORTS,
        "ultra",
      ]),
      model("gpt-5.6-terra", "GPT-5.6 Terra", "medium", [
        ...STANDARD_EFFORTS,
        "ultra",
      ]),
      model("gpt-5.6-luna", "GPT-5.6 Luna", "medium", STANDARD_EFFORTS),
      model("gpt-5.5", "GPT-5.5", "medium", BALANCED_EFFORTS),
      model("gpt-5.2", "GPT-5.2", "medium", BALANCED_EFFORTS),
    ],
  },
  {
    id: "amazon-bedrock",
    displayName: "Amazon Bedrock",
    defaultModel: "openai.gpt-6-sol",
    models: [
      model("openai.gpt-6-sol", "GPT-6 Sol", "medium", [
        "none",
        ...STANDARD_EFFORTS,
      ]),
      model("openai.gpt-6-astra", "GPT-6 Astra", "low", STANDARD_EFFORTS),
      model("openai.gpt-6-luna", "GPT-6 Luna", "medium", [
        "none",
        ...STANDARD_EFFORTS,
      ]),
      model("openai.gpt-5.6-sol", "GPT-5.6 Sol", "low", STANDARD_EFFORTS),
      model(
        "openai.gpt-5.6-terra",
        "GPT-5.6 Terra",
        "medium",
        STANDARD_EFFORTS,
      ),
      model("openai.gpt-5.6-luna", "GPT-5.6 Luna", "medium", STANDARD_EFFORTS),
      model("openai.gpt-5.5", "GPT-5.5", "medium", BALANCED_EFFORTS),
      model("openai.gpt-5.4", "GPT-5.4", "medium", BALANCED_EFFORTS),
    ],
  },
  {
    id: "amazon-bedrock-runtime",
    displayName: "Amazon Bedrock Runtime",
    defaultModel: "global.openai.gpt-6-sol",
    models: [
      ...["global", "us"].flatMap((region) => [
        model(`${region}.openai.gpt-6-sol`, `GPT-6 Sol (${region})`, "medium", [
          "none",
          ...STANDARD_EFFORTS,
        ]),
        model(
          `${region}.openai.gpt-6-astra`,
          `GPT-6 Astra (${region})`,
          "low",
          STANDARD_EFFORTS,
        ),
        model(
          `${region}.openai.gpt-6-luna`,
          `GPT-6 Luna (${region})`,
          "medium",
          ["none", ...STANDARD_EFFORTS],
        ),
        model(
          `${region}.openai.gpt-5.6-sol`,
          `GPT-5.6 Sol (${region})`,
          "low",
          STANDARD_EFFORTS,
        ),
        model(
          `${region}.openai.gpt-5.6-terra`,
          `GPT-5.6 Terra (${region})`,
          "medium",
          STANDARD_EFFORTS,
        ),
        model(
          `${region}.openai.gpt-5.6-luna`,
          `GPT-5.6 Luna (${region})`,
          "medium",
          STANDARD_EFFORTS,
        ),
      ]),
    ],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    defaultModel: "claude-opus-5-5",
    models: [
      model("claude-opus-5-5", "Claude Opus 5.5", "medium", STANDARD_EFFORTS),
      model("claude-fable-5-1", "Claude Fable 5.1", "high", STANDARD_EFFORTS),
      model(
        "claude-mythos-5-1",
        "Claude Mythos 5.1 (invite only)",
        "high",
        STANDARD_EFFORTS,
      ),
      model("claude-opus-5", "Claude Opus 5", "high", STANDARD_EFFORTS),
      model("claude-sonnet-5", "Claude Sonnet 5", "high", STANDARD_EFFORTS),
      model("claude-fable-5", "Claude Fable 5", "high", STANDARD_EFFORTS),
      model(
        "claude-haiku-4-5-20251001",
        "Claude Haiku 4.5",
        "high",
        STANDARD_EFFORTS,
      ),
    ],
  },
  {
    id: "deepmind",
    displayName: "Google DeepMind",
    defaultModel: "gemini-3.1-pro-preview",
    models: [
      model("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", "high", [
        "low",
        "medium",
        "high",
      ]),
      model("gemini-3.8-flash", "Gemini 3.8 Flash", "medium", [
        "low",
        "medium",
        "high",
      ]),
      model("gemini-3.6-flash", "Gemini 3.6 Flash", "medium", [
        "minimal",
        "low",
        "medium",
        "high",
      ]),
      model("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "minimal", [
        "minimal",
        "low",
        "medium",
        "high",
      ]),
      model("gemma-4-31b-it", "Gemma 4 31B IT", "high", ["minimal", "high"]),
      model("gemma-4-26b-a4b-it", "Gemma 4 26B A4B IT", "high", [
        "minimal",
        "high",
      ]),
    ],
  },
];

function model(
  id: string,
  displayName: string,
  defaultReasoningEffort: ReasoningEffort,
  supportedReasoningEfforts: readonly ReasoningEffort[],
): SupportedModel {
  return { id, displayName, defaultReasoningEffort, supportedReasoningEfforts };
}

@Injectable()
export class ModelCatalogService {
  readonly version = "2026-09-27";

  list(providerId?: string): readonly ModelProviderCatalog[] {
    if (!providerId) return PROVIDERS;
    return [this.provider(providerId)];
  }

  resolve(
    providerId?: string,
    requestedModel?: string,
    requestedReasoningEffort?: string,
  ): ResolvedModelSelection {
    const provider = this.provider(providerId ?? "openai");
    const effectiveModel = requestedModel ?? provider.defaultModel;
    const selectedModel = provider.models.find(
      (candidate) => candidate.id === effectiveModel,
    );
    if (!selectedModel) {
      throw new BadRequestException(
        `Model "${effectiveModel}" is not supported by provider "${provider.id}"`,
      );
    }

    const effectiveReasoningEffort =
      requestedReasoningEffort ?? selectedModel.defaultReasoningEffort;
    if (!isReasoningEffort(effectiveReasoningEffort)) {
      throw new BadRequestException(
        `Unknown reasoning effort "${effectiveReasoningEffort}"`,
      );
    }
    if (
      !selectedModel.supportedReasoningEfforts.includes(
        effectiveReasoningEffort,
      )
    ) {
      throw new BadRequestException(
        `Reasoning effort "${effectiveReasoningEffort}" is not supported by model "${selectedModel.id}". Supported efforts: ${selectedModel.supportedReasoningEfforts.join(", ")}`,
      );
    }

    return {
      providerId: provider.id,
      requestedModel: requestedModel ?? null,
      effectiveModel: selectedModel.id,
      requestedReasoningEffort:
        (requestedReasoningEffort as ReasoningEffort | undefined) ?? null,
      effectiveReasoningEffort,
      catalogSnapshot: {
        version: this.version,
        provider: serializeProvider(provider),
      },
    };
  }

  private provider(providerId: string): ModelProviderCatalog {
    const provider = PROVIDERS.find((candidate) => candidate.id === providerId);
    if (!provider) {
      throw new BadRequestException(
        `Model provider "${providerId}" is not configured with a managed catalog`,
      );
    }
    return provider;
  }
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

function serializeProvider(
  provider: ModelProviderCatalog,
): Record<string, unknown> {
  return {
    id: provider.id,
    displayName: provider.displayName,
    defaultModel: provider.defaultModel,
    models: provider.models.map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      defaultReasoningEffort: entry.defaultReasoningEffort,
      supportedReasoningEfforts: [...entry.supportedReasoningEfforts],
    })),
  };
}
