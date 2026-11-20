import {
  BadRequestException,
  Injectable,
  Inject,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import seed = require("./model-catalog.seed.json");

export const MODEL_CATALOG_FILE = Symbol("MODEL_CATALOG_FILE");

export const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepmind: "Google DeepMind",
  "amazon-bedrock": "Amazon Bedrock",
  "amazon-bedrock-runtime": "Amazon Bedrock Runtime",
};
// The CLI currently permits only these providers for new sessions.
export const ACTIVE_PROVIDERS = ["openai", "anthropic", "deepmind"];
export interface CatalogRow {
  providerId: string;
  id: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  priority: number;
  isActive: boolean;
  isAvailable: boolean;
  sunsetAt: string | null;
  maxOutputTokens: number;
  thinkingBudgets: Record<string, number> | null;
}
export function catalogFilePath() {
  const path =
    process.env.CODEX_PROVIDER_CATALOG ??
    join(homedir(), ".proboxai", "provider-models.json");
  if (!isAbsolute(path))
    throw new Error("CODEX_PROVIDER_CATALOG must be an absolute path");
  return path;
}
export function defaultMaxTokens(providerId: string) {
  return providerId === "anthropic" ? 128000 : 65536;
}
export const initialCatalog: CatalogRow[] = seed.map((m) => ({
  ...m,
  isActive: true,
  isAvailable: true,
  sunsetAt: null,
  maxOutputTokens: m.maxOutputTokens ?? defaultMaxTokens(m.providerId),
  thinkingBudgets: m.thinkingBudgets ?? null,
}));
export interface SupportedModel {
  id: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: readonly string[];
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
  requestedReasoningEffort: string | null;
  effectiveReasoningEffort: string;
  catalogSnapshot: Record<string, unknown>;
}

@Injectable()
export class ModelCatalogService {
  constructor(
    @Optional() @Inject(MODEL_CATALOG_FILE) private readonly file?: string,
  ) {}

  snapshot(providerId?: string) {
    if (providerId && !Object.hasOwn(PROVIDER_NAMES, providerId)) {
      throw new BadRequestException(
        `Model provider "${providerId}" is not configured with a managed catalog`,
      );
    }
    let rows: CatalogRow[] = initialCatalog;
    if (this.file) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf8"));
        if (data.schemaVersion !== 1 || !Array.isArray(data.models))
          throw new Error();
        rows = data.models;
      } catch {
        throw new ServiceUnavailableException(
          "Published model catalog is unavailable",
        );
      }
    }
    const now = Date.now();
    const providers: ModelProviderCatalog[] = [];
    for (const id of ACTIVE_PROVIDERS) {
      const models = rows
        .filter(
          (m) =>
            m.providerId === id &&
            m.isActive &&
            m.isAvailable &&
            (m.sunsetAt === null || Date.parse(m.sunsetAt) > now),
        )
        .sort(
          (a, b) =>
            a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .map(
          ({
            id,
            displayName,
            defaultReasoningEffort,
            supportedReasoningEfforts,
          }) => ({
            id,
            displayName,
            defaultReasoningEffort,
            supportedReasoningEfforts,
          }),
        );
      if (models[0])
        providers.push({
          id,
          displayName: PROVIDER_NAMES[id]!,
          defaultModel: models[0].id,
          models,
        });
    }
    const version = createHash("sha256")
      .update(JSON.stringify(rows))
      .update(JSON.stringify(providers))
      .digest("hex");
    return {
      version,
      providers: providerId
        ? providers.filter((p) => p.id === providerId)
        : providers,
    };
  }

  get version() {
    return this.snapshot().version;
  }

  list(providerId?: string) {
    return this.snapshot(providerId).providers;
  }

  resolve(
    providerId?: string,
    requestedModel?: string,
    requestedReasoningEffort?: string,
  ): ResolvedModelSelection {
    const snapshot = this.snapshot();
    const provider = this.provider(snapshot.providers, providerId ?? "openai");
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
      requestedReasoningEffort: requestedReasoningEffort ?? null,
      effectiveReasoningEffort,
      catalogSnapshot: {
        version: snapshot.version,
        provider,
      },
    };
  }

  private provider(
    providers: ModelProviderCatalog[],
    providerId: string,
  ): ModelProviderCatalog {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      if (Object.hasOwn(PROVIDER_NAMES, providerId)) {
        throw new BadRequestException(
          `Model provider "${providerId}" has no models available for new sessions`,
        );
      }
      throw new BadRequestException(
        `Model provider "${providerId}" is not configured with a managed catalog`,
      );
    }
    return provider;
  }
}
