import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCodexModelCatalogCacheForTest,
  loadCodexModelCatalog,
  mapCodexCatalogModels,
  refreshCodexModelCatalogOnStartup,
} from "./codex-model-catalog.js";

const tempRoots: string[] = [];

beforeEach(() => {
  _resetCodexModelCatalogCacheForTest();
});

afterEach(async () => {
  _resetCodexModelCatalogCacheForTest();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function makeBinary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takode-codex-catalog-test-"));
  tempRoots.push(root);
  const binary = join(root, "codex");
  await writeFile(binary, "fake codex binary", "utf-8");
  return binary;
}

function catalog(...models: Record<string, unknown>[]): string {
  return JSON.stringify({ models });
}

describe("Codex model catalog loading", () => {
  it("prefers installed Codex CLI bundled catalog over stale models_cache metadata", async () => {
    const binary = await makeBinary();
    const runCodexCommand = vi.fn(async (_binary: string, args: string[]) => ({
      stdout: args.includes("--version")
        ? "codex-cli 0.144.1\n"
        : catalog({
            slug: "gpt-5.6-sol",
            display_name: "GPT-5.6-Sol",
            description: "Latest frontier agentic coding model.",
            visibility: "list",
            context_window: 372000,
            max_context_window: 372000,
            effective_context_window_percent: 95,
            auto_compact_token_limit: null,
            service_tiers: [{ id: "priority", name: "Fast", description: "1.5x speed" }],
            supported_reasoning_levels: [
              { effort: "low", description: "Fast responses" },
              { effort: "ultra", description: "Maximum reasoning with delegation" },
            ],
            default_reasoning_level: "low",
          }),
    }));

    const result = await loadCodexModelCatalog({
      codexBinary: binary,
      runCodexCommand,
      pathExists: async () => true,
      readFileImpl: async () => catalog({ slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" }) as never,
    });

    expect(result?.source).toBe("installed-cli");
    expect(result?.version).toBe("codex-cli 0.144.1");
    expect(result?.models).toEqual([
      {
        value: "gpt-5.6-sol",
        canonicalIdentity: "gpt-5.6-sol",
        routeEntryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        label: "GPT-5.6-Sol",
        description: "Latest frontier agentic coding model.",
        contextWindow: 372000,
        maxContextWindow: 372000,
        effectiveContextWindowPercent: 95,
        autoCompactTokenLimit: null,
        serviceTiers: [{ id: "priority", name: "Fast", description: "1.5x speed" }],
        supportedReasoningLevels: [
          { effort: "low", description: "Fast responses" },
          { effort: "ultra", description: "Maximum reasoning with delegation" },
        ],
        defaultReasoningLevel: "low",
      },
    ]);
  });

  it("falls back to models_cache when the installed CLI catalog command fails", async () => {
    const binary = await makeBinary();
    const runCodexCommand = vi.fn(async (_binary: string, args: string[]) => {
      if (args.includes("--version")) return { stdout: "codex-cli 0.144.1\n" };
      throw new Error("debug models failed");
    });

    const result = await loadCodexModelCatalog({
      codexBinary: binary,
      runCodexCommand,
      pathExists: async () => true,
      readFileImpl: async () =>
        catalog({
          slug: "gpt-5.4",
          display_name: "GPT-5.4",
          visibility: "list",
          supported_reasoning_levels: [{ effort: "high", description: "Greater reasoning" }],
        }) as never,
    });

    expect(result?.source).toBe("models-cache");
    expect(result?.models[0]).toMatchObject({
      value: "gpt-5.4",
      supportedReasoningLevels: [{ effort: "high", description: "Greater reasoning" }],
    });
  });

  it("caches installed CLI catalog by binary stat and version", async () => {
    const binary = "/tmp/fake-codex";
    let version = "codex-cli 0.144.1\n";
    let slug = "gpt-5.6-sol";
    const runCodexCommand = vi.fn(async (_binary: string, args: string[]) => ({
      stdout: args.includes("--version") ? version : catalog({ slug, display_name: "GPT-5.6-Sol", visibility: "list" }),
    }));
    let mtimeMs = 1;
    const statImpl = vi.fn(async () => ({ mtimeMs, size: 10 }) as never);

    const first = await loadCodexModelCatalog({ codexBinary: binary, runCodexCommand, statImpl });
    const second = await loadCodexModelCatalog({ codexBinary: binary, runCodexCommand, statImpl });
    expect(second).toBe(first);
    expect(runCodexCommand).toHaveBeenCalledTimes(3);

    version = "codex-cli 0.145.0\n";
    slug = "gpt-5.7-sol";
    const versionChanged = await loadCodexModelCatalog({ codexBinary: binary, runCodexCommand, statImpl });
    expect(versionChanged?.models[0]?.value).toBe("gpt-5.7-sol");
    expect(runCodexCommand).toHaveBeenCalledTimes(5);

    mtimeMs = 2;
    await loadCodexModelCatalog({ codexBinary: binary, runCodexCommand, statImpl });
    expect(runCodexCommand).toHaveBeenCalledTimes(7);
  });

  it("coalesces startup refreshes through the same installed CLI cache", async () => {
    const binary = await makeBinary();
    const runCodexCommand = vi.fn(async (_binary: string, args: string[]) => ({
      stdout: args.includes("--version")
        ? "codex-cli 0.144.1\n"
        : catalog({ slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list" }),
    }));

    const [first, second] = await Promise.all([
      refreshCodexModelCatalogOnStartup({ codexBinary: binary, runCodexCommand }),
      refreshCodexModelCatalogOnStartup({ codexBinary: binary, runCodexCommand }),
    ]);

    expect(first?.models[0]?.value).toBe("gpt-5.6-terra");
    expect(second).toBe(first);
    expect(runCodexCommand).toHaveBeenCalledTimes(2);
  });
});

describe("mapCodexCatalogModels", () => {
  it("maps service tiers, context metadata, and supported reasoning levels", () => {
    expect(
      mapCodexCatalogModels({
        models: [
          {
            slug: "gpt-5.6-luna",
            display_name: "GPT-5.6-Luna",
            description: "Fast model",
            visibility: "list",
            context_window: 372000,
            max_context_window: 372000,
            effective_context_window_percent: 95,
            auto_compact_token_limit: null,
            service_tiers: [{ id: "priority", name: "Fast" }],
            supported_reasoning_levels: [{ effort: "max", description: "Maximum reasoning" }],
          },
        ],
      }),
    ).toEqual([
      {
        value: "gpt-5.6-luna",
        canonicalIdentity: "gpt-5.6-luna",
        routeEntryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        label: "GPT-5.6-Luna",
        description: "Fast model",
        contextWindow: 372000,
        maxContextWindow: 372000,
        effectiveContextWindowPercent: 95,
        autoCompactTokenLimit: null,
        serviceTiers: [{ id: "priority", name: "Fast" }],
        supportedReasoningLevels: [{ effort: "max", description: "Maximum reasoning" }],
        defaultReasoningLevel: undefined,
      },
    ]);
  });
});
