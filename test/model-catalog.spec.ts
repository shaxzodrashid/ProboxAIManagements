import { BadRequestException } from "@nestjs/common";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";

describe("ModelCatalogService", () => {
  const catalog = new ModelCatalogService();

  it("resolves the provider and model defaults into an auditable selection", () => {
    expect(catalog.resolve("anthropic")).toMatchObject({
      providerId: "anthropic",
      requestedModel: null,
      effectiveModel: "claude-opus-5-5",
      requestedReasoningEffort: null,
      effectiveReasoningEffort: "medium",
      catalogSnapshot: { version: "2026-09-27" },
    });
  });

  it("allows only efforts supported by the selected model", () => {
    expect(
      catalog.resolve("deepmind", "gemma-4-31b-it", "minimal"),
    ).toMatchObject({ effectiveReasoningEffort: "minimal" });
    expect(() => catalog.resolve("deepmind", "gemma-4-31b-it", "low")).toThrow(
      BadRequestException,
    );
  });

  it("does not silently substitute an unknown provider, model, or effort", () => {
    expect(() => catalog.resolve("ollama", "qwen3")).toThrow(
      'Model provider "ollama" is not configured',
    );
    expect(() => catalog.resolve("openai", "gpt-not-real")).toThrow(
      'Model "gpt-not-real" is not supported',
    );
    expect(() => catalog.resolve("openai", "gpt-5.5", "ultra")).toThrow(
      'Reasoning effort "ultra" is not supported',
    );
  });

  it("does not expose hidden models through the management catalog", () => {
    const openAi = catalog.list("openai")[0]!;
    expect(openAi.models.map((entry) => entry.id)).not.toContain("gpt-5.4");
  });

  it("matches the fork's new provider-specific efforts without substituting models", () => {
    expect(catalog.resolve().effectiveModel).toBe("gpt-6-sol");
    expect(
      catalog.resolve("openai", "gpt-6-sol", "none").effectiveReasoningEffort,
    ).toBe("none");
    expect(
      catalog.resolve("openai", "gpt-6-astra").effectiveReasoningEffort,
    ).toBe("low");
    expect(() => catalog.resolve("openai", "gpt-6-luna", "ultra")).toThrow();
    expect(() => catalog.resolve("openai", "gpt-6-astra", "none")).toThrow();
    expect(
      catalog.resolve("anthropic", "claude-fable-5-1", "max").effectiveModel,
    ).toBe("claude-fable-5-1");
    expect(
      catalog.resolve("anthropic", "claude-mythos-5-1")
        .effectiveReasoningEffort,
    ).toBe("high");
    expect(
      catalog.resolve("deepmind", "gemini-3.8-flash").effectiveReasoningEffort,
    ).toBe("medium");
    expect(() =>
      catalog.resolve("deepmind", "gemini-3.8-flash", "minimal"),
    ).toThrow();
    expect(
      catalog.resolve(
        "amazon-bedrock-runtime",
        "global.openai.gpt-6-sol",
        "none",
      ).effectiveModel,
    ).toBe("global.openai.gpt-6-sol");
    expect(() =>
      catalog.resolve("amazon-bedrock", "global.openai.gpt-6-sol"),
    ).toThrow();
    expect(() =>
      catalog.resolve(
        "amazon-bedrock-runtime",
        "global.openai.gpt-6-sol",
        "ultra",
      ),
    ).toThrow();
  });

  it("keeps every Telegram selection callback within the 64-byte limit", () => {
    for (const provider of catalog.list())
      for (const model of provider.models) {
        for (const effort of model.supportedReasoningEfforts)
          expect(
            Buffer.byteLength(`e:${provider.id}:${model.id}:${effort}`),
          ).toBeLessThanOrEqual(64);
      }
  });
});
