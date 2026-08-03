import { BadRequestException } from "@nestjs/common";
import { ModelCatalogService } from "../src/sessions/model-catalog.service";

describe("ModelCatalogService", () => {
  const catalog = new ModelCatalogService();

  it("resolves the provider and model defaults into an auditable selection", () => {
    expect(catalog.resolve("anthropic")).toMatchObject({
      providerId: "anthropic",
      requestedModel: null,
      effectiveModel: "claude-opus-5",
      requestedReasoningEffort: null,
      effectiveReasoningEffort: "high",
      catalogSnapshot: { version: "2026-08-03" },
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
});
