import { describe, expect, it } from "vitest";
import { getClaudeModelCatalog, mapClaudeCatalogModels, recordClaudeModelCatalog } from "./claude-model-catalog.js";

// Shape reported by Claude Code 2.1.289's `supportedModels()` for a Copilot
// gateway setup whose settings map the Opus and Haiku aliases to dotted IDs.
const CLI_CATALOG = [
  {
    value: "default",
    resolvedModel: "claude-opus-5.5",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5) · $5/$25 per Mtok",
  },
  { value: "opus", resolvedModel: "claude-opus-5.5", displayName: "claude-opus-5.5", description: "Custom Opus model" },
  { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable", description: "Fable 5.1" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet", description: "Sonnet 5.5" },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4.5",
    displayName: "claude-haiku-4.5",
    description: "Custom Haiku model",
  },
];

describe("mapClaudeCatalogModels", () => {
  it("keys options by resolved model and folds aliases of the default model into one entry", () => {
    // Selecting an option must send the concrete model the CLI would use, and
    // the `opus` alias resolving to the same model as `default` must not
    // produce a duplicate menu entry.
    expect(mapClaudeCatalogModels(CLI_CATALOG)).toEqual([
      {
        value: "claude-opus-5.5",
        label: "Opus 5.5 (default)",
        description: "Use the default model (currently Opus 5) · $5/$25 per Mtok",
        isDefault: true,
      },
      { value: "claude-fable-5-1", label: "Fable 5.1", description: "Fable 5.1" },
      { value: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Sonnet 5.5" },
      { value: "claude-haiku-4.5", label: "Haiku 4.5", description: "Custom Haiku model" },
    ]);
  });

  it("falls back to the alias and display name when the CLI does not report a resolved model", () => {
    // Older CLIs omit `resolvedModel`; the alias itself is still a valid model value.
    expect(
      mapClaudeCatalogModels([
        { value: "default", displayName: "Default (recommended)", description: "" },
        { value: "sonnet[1m]", displayName: "Sonnet (1M context)", description: "" },
      ]),
    ).toEqual([
      { value: "default", label: "Default (recommended)", description: "", isDefault: true },
      { value: "sonnet[1m]", label: "Sonnet (1M context)", description: "" },
    ]);
  });

  it("formats dated and context-tagged model IDs", () => {
    expect(
      mapClaudeCatalogModels([
        { value: "a", resolvedModel: "claude-sonnet-4-5-20250929" },
        { value: "b", resolvedModel: "claude-opus-4-6[1m]" },
      ]).map((model) => model.label),
    ).toEqual(["Sonnet 4.5", "Opus 4.6 [1M]"]);
  });

  it("ignores malformed entries", () => {
    expect(mapClaudeCatalogModels(null)).toEqual([]);
    expect(mapClaudeCatalogModels([null, { value: "" }, { displayName: "x" }])).toEqual([]);
  });
});

describe("recordClaudeModelCatalog", () => {
  it("keeps the last usable catalog when a later report is empty", () => {
    // A session whose initialization returns nothing must not erase a catalog
    // another session already reported.
    recordClaudeModelCatalog(CLI_CATALOG);
    recordClaudeModelCatalog([]);
    expect(getClaudeModelCatalog()?.map((model) => model.value)).toEqual([
      "claude-opus-5.5",
      "claude-fable-5-1",
      "claude-sonnet-5-5",
      "claude-haiku-4.5",
    ]);
  });
});
