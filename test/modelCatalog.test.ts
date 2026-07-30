import { describe, expect, it } from "vitest";
import {
  createManualModels,
  filterModels,
  fromProviderModelId,
  parseModelListResponse,
  toProviderModelId
} from "../src/modelCatalog";

describe("parseModelListResponse", () => {
  it("preserves explicit model IDs and reasoning effort order", () => {
    const result = parseModelListResponse({
      data: [
        {
          id: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          description: "Frontier coding model",
          hidden: false,
          defaultReasoningEffort: "low",
          isDefault: true,
          inputModalities: ["text"],
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "high", description: "Deep" },
            { reasoningEffort: "ultra", description: "Maximum" }
          ]
        }
      ],
      nextCursor: "page-2"
    });

    expect(result.nextCursor).toBe("page-2");
    expect(result.models).toEqual([
      {
        id: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        description: "Frontier coding model",
        hidden: false,
        defaultReasoningEffort: "low",
        isDefault: true,
        inputModalities: ["text"],
        supportedReasoningEfforts: ["low", "high", "ultra"]
      }
    ]);
  });

  it("rejects malformed model entries and cursors", () => {
    expect(() =>
      parseModelListResponse({ data: [{ id: "missing-fields" }], nextCursor: null })
    ).toThrow("entry 1 is malformed");
    expect(() =>
      parseModelListResponse({ data: [], nextCursor: 123 })
    ).toThrow("invalid pagination cursor");
  });
});

describe("manual and enabled models", () => {
  it("trims, deduplicates, and filters explicit models", () => {
    const manual = createManualModels([
      " gpt-5.4 ",
      "gpt-5.4-mini",
      "gpt-5.4",
      ""
    ]);
    const filtered = filterModels(manual, ["gpt-5.4-mini"]);

    expect(manual.map(model => model.model)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini"
    ]);
    expect(filtered.map(model => model.model)).toEqual(["gpt-5.4-mini"]);
  });

  it("exposes every non-hidden model when the allowlist is empty", () => {
    const manual = createManualModels(["gpt-5.4", "gpt-5.5"]);
    expect(filterModels(manual, [])).toHaveLength(2);
  });
});

describe("provider model IDs", () => {
  it("round-trips explicit model IDs without a default fallback", () => {
    const providerId = toProviderModelId("vendor/model:high");
    expect(providerId).toBe("codex-subscription:vendor%2Fmodel%3Ahigh");
    expect(fromProviderModelId(providerId)).toBe("vendor/model:high");
  });

  it("rejects model IDs from another provider", () => {
    expect(() => fromProviderModelId("other:model")).toThrow(
      "Unsupported Codex provider model ID"
    );
  });
});
describe("model input modalities", () => {
  it("uses the Codex compatibility default when modalities are omitted", () => {
    const result = parseModelListResponse({
      data: [{
        id: "legacy",
        model: "legacy",
        displayName: "Legacy",
        description: "Legacy catalog entry",
        hidden: false,
        defaultReasoningEffort: "medium",
        isDefault: false,
        supportedReasoningEfforts: []
      }],
      nextCursor: null
    });

    expect(result.models[0]?.inputModalities).toEqual(["text", "image"]);
  });

  it("gives manual Codex models the compatibility modalities", () => {
    expect(createManualModels(["manual"])[0]?.inputModalities).toEqual([
      "text",
      "image"
    ]);
  });
});