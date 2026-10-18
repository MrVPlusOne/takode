import { describe, expect, it, vi } from "vitest";
import { findCodexCatalogModel, settleCodexCatalogModelEntries } from "./codex-session-catalog-entries.js";

// Shaped like `codex debug models --bundled` output: Codex 0.162 entries carry the
// built-in prompt in model_messages.instructions_template and mirror it in the
// legacy base_instructions field.
function codexEntry(slug: string, prompt = `Built-in prompt for ${slug}`): Record<string, any> {
  return {
    slug,
    display_name: slug.toUpperCase(),
    shell_type: "unified_exec",
    apply_patch_tool_type: "freeform",
    base_instructions: prompt,
    model_messages: { instructions_template: prompt, approvals: { text: "approvals" } },
  };
}

// The minimal entry older Takode versions synthesized and wrote into session catalogs.
const legacySynthesizedEntry = (slug: string) => ({ slug, base_instructions: "", context_window: 736_843 });

describe("findCodexCatalogModel", () => {
  // Mirrors Codex's construct_model_info_from_candidates so a Takode-added entry is
  // the one Codex would have resolved for the slug on its own.
  it("picks the longest slug prefix, then retries a namespaced slug without its namespace", () => {
    const models = [codexEntry("gpt-6"), codexEntry("gpt-6-astra"), codexEntry("other")];
    expect(findCodexCatalogModel("gpt-6-astra", models)?.slug).toBe("gpt-6-astra");
    expect(findCodexCatalogModel("gpt-6-astra-preview", models)?.slug).toBe("gpt-6-astra");
    expect(findCodexCatalogModel("gpt-6-sol", models)?.slug).toBe("gpt-6");
    expect(findCodexCatalogModel("copilot/gpt-6-astra", models)?.slug).toBe("gpt-6-astra");
    expect(findCodexCatalogModel("a/b/gpt-6", models)).toBeUndefined();
    expect(findCodexCatalogModel("unknown", models)).toBeUndefined();
  });

  it("never resolves to an entry without a built-in prompt", () => {
    expect(findCodexCatalogModel("gpt-6-astra", [legacySynthesizedEntry("gpt-6-astra")])).toBeUndefined();
  });
});

describe("settleCodexCatalogModelEntries", () => {
  it("adds a missing selected model as Codex's own entry instead of an empty-prompt stub", async () => {
    const models: unknown[] = [];
    const loadCodexCatalog = vi.fn(async () => ({ models: [codexEntry("gpt-6-astra"), codexEntry("gpt-5.5")] }));
    const createModelEntry = vi.fn((slug: string) => ({ slug }));

    const settled = await settleCodexCatalogModelEntries(models, "gpt-6-astra", { loadCodexCatalog, createModelEntry });

    expect(createModelEntry).not.toHaveBeenCalled();
    expect(settled.changed).toBe(true);
    expect(settled.modelEntry).toMatchObject({
      slug: "gpt-6-astra",
      shell_type: "unified_exec",
      apply_patch_tool_type: "freeform",
      model_messages: { instructions_template: "Built-in prompt for gpt-6-astra" },
    });
    expect(models).toEqual([settled.modelEntry]);
  });

  it("resolves a missing model by prefix in the session catalog before the bundled one", async () => {
    const models: unknown[] = [codexEntry("gpt-5.5", "Account prompt")];
    const loadCodexCatalog = vi.fn(async () => ({ models: [codexEntry("gpt-5.5", "Bundled prompt")] }));

    const settled = await settleCodexCatalogModelEntries(models, "gpt-5.5-preview", {
      loadCodexCatalog,
      createModelEntry: (slug) => ({ slug }),
    });

    expect(settled.modelEntry).toMatchObject({ slug: "gpt-5.5-preview", base_instructions: "Account prompt" });
    expect(loadCodexCatalog).not.toHaveBeenCalled();
  });

  it("replaces an entry that has no built-in prompt, so sessions written by older Takode heal", async () => {
    const models: unknown[] = [legacySynthesizedEntry("gpt-6-astra"), codexEntry("gpt-5.5")];

    const settled = await settleCodexCatalogModelEntries(models, "gpt-6-astra", {
      loadCodexCatalog: async () => ({ models: [codexEntry("gpt-6-astra")] }),
    });

    expect(settled.changed).toBe(true);
    // The whole entry is Codex's: the stub's shell and tool setup were invented too.
    expect(settled.modelEntry).toMatchObject(codexEntry("gpt-6-astra"));
    expect(settled.modelEntry?.context_window).toBeUndefined();
    expect(models[1]).toMatchObject(codexEntry("gpt-5.5"));
  });

  it("keeps a parseable stub, with a warning, only for a model no catalog knows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const models: unknown[] = [];

    const settled = await settleCodexCatalogModelEntries(models, "custom-model", {
      loadCodexCatalog: async () => ({ models: [codexEntry("gpt-6-astra")] }),
      createModelEntry: (slug) => ({ slug, context_window: 100_000 }),
    });

    expect(settled.modelEntry).toMatchObject({ slug: "custom-model", context_window: 100_000, base_instructions: "" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("custom-model"));
    warn.mockRestore();
  });

  it("does not load the bundled catalog when every entry already has a prompt", async () => {
    const loadCodexCatalog = vi.fn(async () => null);
    const models: unknown[] = [codexEntry("gpt-6-astra")];

    const settled = await settleCodexCatalogModelEntries(models, "gpt-6-astra", { loadCodexCatalog });

    expect(loadCodexCatalog).not.toHaveBeenCalled();
    expect(settled.modelEntry?.model_messages.instructions_template).toBe("Built-in prompt for gpt-6-astra");
  });
});
