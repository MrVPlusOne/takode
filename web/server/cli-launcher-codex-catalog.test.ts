import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { _ensureCodexSessionConfigForTest } from "./cli-launcher-codex.js";

describe("Codex session catalog hardening", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeCodexHome(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "takode-codex-catalog-"));
    tempRoots.push(root);
    return root;
  }

  function expectParserSafeEntry(entry: Record<string, unknown>, slug: string): void {
    expect(entry).toMatchObject({
      slug,
      display_name: expect.any(String),
      supported_reasoning_levels: expect.any(Array),
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: expect.any(Number),
      base_instructions: expect.any(String),
      supports_reasoning_summaries: expect.any(Boolean),
      support_verbosity: expect.any(Boolean),
      truncation_policy: {
        mode: expect.any(String),
        limit: expect.any(Number),
      },
      supports_parallel_tool_calls: expect.any(Boolean),
      experimental_supported_tools: expect.any(Array),
    });
  }

  it("synthesizes a parser-valid leader catalog entry when no source entry exists", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const catalogPath = join(codexHome, "takode-leader-model-catalog.json");
    const model = "takode-test-leader";
    await writeFile(configPath, `model = "${model}"\n`, "utf-8");
    await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ models: [] }), "utf-8");

    await _ensureCodexSessionConfigForTest(codexHome, [], {
      leaderRecycleThresholdTokens: 260_000,
      model,
    });

    const config = await readFile(configPath, "utf-8");
    expect(config).toContain(`model_catalog_json = ${JSON.stringify(catalogPath)}`);
    expect(config).toContain("model_context_window = 344445");
    expect(config).toContain("model_auto_compact_token_limit = 310000");

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.models).toHaveLength(1);
    expectParserSafeEntry(catalog.models[0], model);
    expect(catalog.models[0]).toMatchObject({
      context_window: 344_445,
      max_context_window: 344_445,
      effective_context_window_percent: 95,
      auto_compact_token_limit: 310_000,
    });
  });

  it("derives leader recycle threshold from source effective context minus the fixed buffer", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const catalogPath = join(codexHome, "takode-leader-model-catalog.json");
    const model = "takode-test-large";
    await writeFile(configPath, `model = "${model}"\n`, "utf-8");
    await writeFile(
      join(codexHome, "models_cache.json"),
      JSON.stringify({
        models: [
          {
            slug: model,
            context_window: 600_000,
            max_context_window: 600_000,
            effective_context_window_percent: 95,
            auto_compact_token_limit: null,
          },
        ],
      }),
      "utf-8",
    );

    const result = await _ensureCodexSessionConfigForTest(codexHome, [], { model });

    // The leader recycle threshold uses source effective context (600K * 95%)
    // minus the fixed 25K buffer, while q-1446's provider guard stays higher.
    expect(result.leaderRecycleThresholdTokens).toBe(545_000);
    const config = await readFile(configPath, "utf-8");
    expect(config).toContain("model_context_window = 666112");
    expect(config).toContain("model_auto_compact_token_limit = 599500");

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.models[0]).toMatchObject({
      context_window: 666_112,
      max_context_window: 666_112,
      effective_context_window_percent: 95,
      auto_compact_token_limit: 599_500,
    });
  });

  it("does not derive relaunch thresholds from Takode's generated leader catalog", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const catalogPath = join(codexHome, "takode-leader-model-catalog.json");
    const model = "takode-test-relaunch";
    await writeFile(
      configPath,
      [
        `model = "${model}"`,
        "model_context_window = 631053",
        "model_auto_compact_token_limit = 599500",
        `model_catalog_json = ${JSON.stringify(catalogPath)}`,
        "",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      catalogPath,
      JSON.stringify({
        models: [
          {
            slug: model,
            context_window: 631_053,
            max_context_window: 631_053,
            effective_context_window_percent: 95,
            auto_compact_token_limit: 599_500,
          },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ models: [] }), "utf-8");

    const result = await _ensureCodexSessionConfigForTest(codexHome, [], { model });

    // Relaunch prep must not treat Takode's own generated leader catalog or
    // top-level guard values as source model capacity, or thresholds drift up.
    expect(result.leaderRecycleThresholdTokens).toBe(260_000);
    const config = await readFile(configPath, "utf-8");
    expect(config).toContain("model_context_window = 344445");
    expect(config).toContain("model_auto_compact_token_limit = 310000");
  });

  it("synthesizes a non-leader catalog entry from an existing raw context setting", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const catalogPath = join(codexHome, "takode-model-catalog.json");
    const model = "takode-test-worker";
    await writeFile(configPath, `model = "${model}"\nmodel_context_window = 600000\n`, "utf-8");
    await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ models: [] }), "utf-8");

    await _ensureCodexSessionConfigForTest(codexHome, [], {
      nonLeaderAutoCompactThresholdPercent: 90,
      model,
    });

    const config = await readFile(configPath, "utf-8");
    // Keep the top-level raw context for startup/status readers; the catalog
    // makes the app-server model metadata path agree with the same raw value.
    expect(config).toContain("model_context_window = 600000");
    expect(config).toContain(`model_catalog_json = ${JSON.stringify(catalogPath)}`);

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.models).toHaveLength(1);
    expectParserSafeEntry(catalog.models[0], model);
    expect(catalog.models[0]).toMatchObject({
      context_window: 600_000,
      max_context_window: 600_000,
      effective_context_window_percent: 95,
      auto_compact_token_limit: 513_000,
    });
  });

  it("adds a missing selected model to an otherwise valid catalog", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const sourceCatalogPath = join(codexHome, "models_cache.json");
    const catalogPath = join(codexHome, "takode-leader-model-catalog.json");
    const model = "takode-test-missing";
    await writeFile(configPath, `model = "${model}"\n`, "utf-8");
    await writeFile(
      sourceCatalogPath,
      JSON.stringify({ models: [{ slug: "other-model", context_window: 1000 }] }, null, 2),
      "utf-8",
    );

    await _ensureCodexSessionConfigForTest(codexHome, [], {
      leaderRecycleThresholdTokens: 260_000,
      model,
    });

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.models.map((entry: Record<string, unknown>) => entry.slug)).toEqual(["other-model", model]);
    const added = catalog.models.find((entry: Record<string, unknown>) => entry.slug === model);
    expectParserSafeEntry(added, model);
    expect(added).toMatchObject({
      context_window: 344_445,
      max_context_window: 344_445,
      auto_compact_token_limit: 310_000,
    });
  });

  it("repairs a legacy minimal configured catalog during relaunch prep", async () => {
    const codexHome = await makeCodexHome();
    const configPath = join(codexHome, "config.toml");
    const catalogPath = join(codexHome, "takode-leader-model-catalog.json");
    const model = "takode-test-repair";
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      configPath,
      [`model = "${model}"`, `model_catalog_json = ${JSON.stringify(catalogPath)}`, ""].join("\n"),
      "utf-8",
    );
    await writeFile(catalogPath, JSON.stringify({ models: [{ slug: model }] }, null, 2), "utf-8");

    await _ensureCodexSessionConfigForTest(codexHome, [], {
      leaderRecycleThresholdTokens: 260_000,
      model,
    });

    const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));
    expect(catalog.models).toHaveLength(1);
    expectParserSafeEntry(catalog.models[0], model);
    expect(catalog.models[0]).toMatchObject({
      context_window: 344_445,
      max_context_window: 344_445,
      auto_compact_token_limit: 310_000,
    });
  });

  it("uses container catalog paths in generated config while writing the host-side catalog content", async () => {
    const codexHome = await makeCodexHome();
    const containerCatalogPath = "/root/.codex/takode-leader-model-catalog.json";
    const model = "takode-test-container";
    await writeFile(join(codexHome, "config.toml"), `model = "${model}"\n`, "utf-8");
    await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ models: [] }), "utf-8");

    const result = await _ensureCodexSessionConfigForTest(codexHome, [], {
      leaderRecycleThresholdTokens: 260_000,
      model,
      modelCatalogConfigPath: containerCatalogPath,
    });

    expect(result.configToml).toContain(`model_catalog_json = ${JSON.stringify(containerCatalogPath)}`);
    expect(result.modelCatalogJson).toBeDefined();
    const catalog = JSON.parse(result.modelCatalogJson!);
    const entry = catalog.models.find((candidate: Record<string, unknown>) => candidate.slug === model);
    expectParserSafeEntry(entry, model);
  });
});
