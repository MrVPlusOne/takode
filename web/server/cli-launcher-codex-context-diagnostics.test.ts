import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCodexSpawn } from "./cli-launcher-codex.js";
import { resolveCodexContextWindowDiagnostics } from "./codex-context-launch-diagnostics.js";

const MODEL = "gpt-5.6-sol";

describe("Codex launch-resolved context diagnostics", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
  }

  async function prepare(options: {
    sessionId: string;
    leader?: boolean;
    leaderMode?: "recycle" | "compact";
    usableCapacity?: number;
    existingRecycleBudget?: number;
    effectivePercent?: number;
    configToml?: string;
  }) {
    const codexHome = await makeRoot("takode-codex-diagnostics-");
    const legacyCodexHome = await makeRoot("takode-codex-diagnostics-legacy-");
    const agentsSkillsHome = await makeRoot("takode-codex-diagnostics-skills-");
    const sessionHome = join(codexHome, options.sessionId);
    await mkdir(sessionHome, { recursive: true });
    await writeFile(join(sessionHome, "config.toml"), options.configToml ?? `model = "${MODEL}"\n`, "utf-8");
    if (options.effectivePercent) {
      await writeFile(
        join(sessionHome, "models_cache.json"),
        JSON.stringify({
          models: [
            {
              slug: MODEL,
              context_window: 600_000,
              max_context_window: 600_000,
              effective_context_window_percent: options.effectivePercent,
            },
          ],
        }),
        "utf-8",
      );
    }

    const spawn = await prepareCodexSpawn(
      options.sessionId,
      {
        cwd: "/repo",
        isOrchestrator: options.leader,
        codexLeaderCompactionMode: options.leaderMode,
        codexLeaderRecycleThresholdTokens: options.existingRecycleBudget,
      },
      {
        containerId: "container-1",
        codexHome,
        codexLegacyHome: legacyCodexHome,
        codexAgentsSkillsHome: agentsSkillsHome,
        codexHomePrepared: true,
        codexSpawnPrepYieldEveryMs: Number.POSITIVE_INFINITY,
        model: MODEL,
        codexMaxContextLength: options.usableCapacity,
        codexLeaderCompactionMode: options.leaderMode,
      },
    );
    const shellScript = spawn.spawnCmd.at(-1) ?? "";
    const launchLine = shellScript.split("\n").find((line) => line.startsWith("exec "));
    return { spawn, sessionHome, launchLine };
  }

  it("reports the exact configured 760K worker launch values", async () => {
    const { spawn, sessionHome, launchLine } = await prepare({
      sessionId: "configured-worker",
      usableCapacity: 760_000,
      effectivePercent: 95,
    });

    expect(spawn.contextWindowDiagnostics).toEqual({
      role: "non_leader",
      capacitySource: "configured_usable_capacity",
      configuredUsableContextWindow: 760_000,
      displayContextWindow: 760_000,
      providerRawContextWindow: 800_000,
      catalogEffectiveContextWindowPercent: 95,
      providerEffectiveContextWindow: 760_000,
      autoCompactTokenLimit: 684_000,
      autoCompactTokenLimitScope: "total",
    });
    expect(launchLine).toContain("model_context_window=800000");
    expect(launchLine).toContain("model_auto_compact_token_limit=684000");
    expect(launchLine).not.toContain("model_auto_compact_token_limit_scope");
    expect(await readFile(join(sessionHome, "config.toml"), "utf-8")).not.toContain(
      "model_auto_compact_token_limit_scope",
    );
  });

  it("reports the exact configured 770K compact-mode leader values", async () => {
    const { spawn, launchLine } = await prepare({
      sessionId: "compact-leader",
      leader: true,
      leaderMode: "compact",
      usableCapacity: 770_000,
      effectivePercent: 95,
    });

    expect(spawn.contextWindowDiagnostics).toEqual({
      role: "leader",
      leaderMode: "compact",
      capacitySource: "configured_usable_capacity",
      configuredUsableContextWindow: 770_000,
      displayContextWindow: 770_000,
      providerRawContextWindow: 810_527,
      catalogEffectiveContextWindowPercent: 95,
      providerEffectiveContextWindow: 770_000,
      autoCompactTokenLimit: 693_000,
      autoCompactTokenLimitScope: "total",
    });
    expect(launchLine).toContain("/root/.codex/takode-model-catalog.json");
    expect(launchLine).not.toContain("takode-leader-model-catalog.json");
    expect(launchLine).toContain("model_context_window=810527");
    expect(launchLine).toContain("model_auto_compact_token_limit=693000");
  });

  it("keeps the configured 770K leader recycle budget separate from the hidden provider envelope", async () => {
    const { spawn, launchLine } = await prepare({
      sessionId: "recycle-leader",
      leader: true,
      leaderMode: "recycle",
      usableCapacity: 770_000,
      effectivePercent: 95,
    });

    expect(spawn.contextWindowDiagnostics).toEqual({
      role: "leader",
      leaderMode: "recycle",
      capacitySource: "leader_recycle_guard",
      configuredUsableContextWindow: 770_000,
      displayContextWindow: 770_000,
      providerRawContextWindow: 4_277_778,
      catalogEffectiveContextWindowPercent: 95,
      providerEffectiveContextWindow: 4_063_889,
      autoCompactTokenLimit: 3_850_000,
      autoCompactTokenLimitScope: "total",
    });
    expect(spawn.codexLeaderRecycleThresholdTokens).toBe(770_000);
    expect(launchLine).toContain("/root/.codex/takode-leader-model-catalog.json");
    expect(launchLine).toContain("model_context_window=4277778");
    expect(launchLine).toContain("model_auto_compact_token_limit=3850000");
  });

  it("preserves the latest recycle budget on a model-only leader relaunch", async () => {
    const { spawn, launchLine } = await prepare({
      sessionId: "model-only-relaunch",
      leader: true,
      leaderMode: "recycle",
      existingRecycleBudget: 770_000,
      effectivePercent: 95,
    });

    expect(spawn.contextWindowDiagnostics).toMatchObject({
      role: "leader",
      leaderMode: "recycle",
      capacitySource: "leader_recycle_guard",
      displayContextWindow: 770_000,
      providerRawContextWindow: 4_277_778,
      providerEffectiveContextWindow: 4_063_889,
      autoCompactTokenLimit: 3_850_000,
    });
    expect(spawn.contextWindowDiagnostics).not.toHaveProperty("configuredUsableContextWindow");
    expect(launchLine).toContain("model_context_window=4277778");
  });

  it("leaves unconfigured worker values unknown while reporting the proven Codex scope default", async () => {
    const { spawn, launchLine } = await prepare({ sessionId: "default-worker" });

    expect(spawn.contextWindowDiagnostics).toEqual({
      role: "non_leader",
      capacitySource: "codex_default",
      autoCompactTokenLimitScope: "total",
    });
    expect(launchLine).not.toContain("model_context_window=");
    expect(launchLine).not.toContain("model_auto_compact_token_limit=");
  });

  it("preserves and reports a user-owned compact-limit scope on configured launches", async () => {
    const { spawn, sessionHome, launchLine } = await prepare({
      sessionId: "configured-worker-custom-scope",
      usableCapacity: 760_000,
      effectivePercent: 95,
      configToml: [`model = "${MODEL}"`, 'model_auto_compact_token_limit_scope = "body_after_prefix"', ""].join("\n"),
    });

    expect(spawn.contextWindowDiagnostics.autoCompactTokenLimitScope).toBe("body_after_prefix");
    expect(launchLine).not.toContain("model_auto_compact_token_limit_scope");
    expect(await readFile(join(sessionHome, "config.toml"), "utf-8")).toContain(
      'model_auto_compact_token_limit_scope = "body_after_prefix"',
    );
  });

  it("reports only values proven by an unowned Codex config/catalog", async () => {
    const codexHome = await makeRoot("takode-codex-config-diagnostics-");
    const catalogPath = join(codexHome, "custom-models.json");
    await writeFile(
      catalogPath,
      JSON.stringify({
        models: [
          {
            slug: MODEL,
            context_window: 600_000,
            max_context_window: 600_000,
            effective_context_window_percent: 80,
            auto_compact_token_limit: 510_000,
          },
        ],
      }),
      "utf-8",
    );
    const diagnostics = await resolveCodexContextWindowDiagnostics({
      codexHome,
      configToml: [
        `model = "${MODEL}"`,
        `model_catalog_json = ${JSON.stringify(catalogPath)}`,
        "model_context_window = 600000",
        "model_auto_compact_token_limit = 510000",
        'model_auto_compact_token_limit_scope = "body_after_prefix"',
        "",
      ].join("\n"),
      model: MODEL,
      role: "non_leader",
    });

    expect(diagnostics).toEqual({
      role: "non_leader",
      capacitySource: "codex_config",
      displayContextWindow: 480_000,
      providerRawContextWindow: 600_000,
      catalogEffectiveContextWindowPercent: 80,
      providerEffectiveContextWindow: 480_000,
      autoCompactTokenLimit: 510_000,
      autoCompactTokenLimitScope: "body_after_prefix",
    });
  });

  it("reports the provider's 90% clamp for total-scope Codex config", async () => {
    const codexHome = await makeRoot("takode-codex-total-scope-diagnostics-");
    const catalogPath = join(codexHome, "custom-models.json");
    await writeFile(
      catalogPath,
      JSON.stringify({
        models: [
          {
            slug: MODEL,
            context_window: 600_000,
            effective_context_window_percent: 80,
            auto_compact_token_limit: 510_000,
          },
        ],
      }),
      "utf-8",
    );

    const diagnostics = await resolveCodexContextWindowDiagnostics({
      codexHome,
      configToml: [
        `model = "${MODEL}"`,
        `model_catalog_json = ${JSON.stringify(catalogPath)}`,
        "model_context_window = 600000",
        "model_auto_compact_token_limit = 510000",
        'model_auto_compact_token_limit_scope = "total"',
        "",
      ].join("\n"),
      model: MODEL,
      role: "non_leader",
    });

    expect(diagnostics.autoCompactTokenLimit).toBe(432_000);
    expect(diagnostics.autoCompactTokenLimitScope).toBe("total");
  });
});
