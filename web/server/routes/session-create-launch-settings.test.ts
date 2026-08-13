import { afterEach, describe, expect, it } from "vitest";
import { _resetCodexModelCatalogCacheForTest, loadCodexModelCatalog } from "../codex-model-catalog.js";
import { buildSessionBackendLaunchSettings } from "./session-create-launch-settings.js";

afterEach(() => _resetCodexModelCatalogCacheForTest());

async function cacheModels(models: Array<Record<string, unknown>>) {
  await loadCodexModelCatalog({
    codexBinary: "/fake/codex",
    statImpl: (async () => ({ mtimeMs: 1, size: 1 })) as never,
    runCodexCommand: async (_binary, args) => ({
      stdout: args[0] === "--version" ? "codex-cli test" : JSON.stringify({ models }),
    }),
  });
}

describe("session create backend launch settings", () => {
  it("applies the same Codex launch fields to normal and external-resume creation", () => {
    // This helper is intentionally shared by both route branches so resume cannot
    // silently drop Worker Defaults that normal creation carries to the launcher.
    expect(
      buildSessionBackendLaunchSettings(
        {
          codexInternetAccess: true,
          codexReasoningEffort: "ultra",
          codexServiceTier: "priority",
          codexMaxContextLength: 760_000,
        },
        "codex",
        "codex-full-access",
        "gpt-5.6-sol",
      ),
    ).toMatchObject({
      codexInternetAccess: true,
      codexSandbox: "danger-full-access",
      codexReasoningEffort: "ultra",
      codexServiceTier: "priority",
      codexMaxContextLength: 760_000,
    });
  });

  it("fails closed when the cached installed catalog rejects the model-effort pair", async () => {
    await cacheModels([
      {
        slug: "gpt-limited",
        display_name: "GPT Limited",
        visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      },
    ]);
    expect(() =>
      buildSessionBackendLaunchSettings({ codexReasoningEffort: "ultra" }, "codex", "codex-default", "gpt-limited"),
    ).toThrow('Codex reasoning effort "ultra" is not supported by model "gpt-limited"');
  });
});
