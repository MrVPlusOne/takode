import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareCodexSpawn } from "./cli-launcher-codex.js";

describe("Codex leader compaction mode launch prep", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function makeCodexHomeRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "takode-codex-leader-mode-"));
    tempRoots.push(root);
    return root;
  }

  it("keeps delegate MCP for compact-mode leaders while disabling recycle guard config", async () => {
    const codexHome = await makeCodexHomeRoot();
    const legacyCodexHome = await makeCodexHomeRoot();
    const agentsSkillsHome = await makeCodexHomeRoot();
    await mkdir(join(codexHome, "compact-leader"), { recursive: true });
    const spawn = await prepareCodexSpawn(
      "compact-leader",
      {
        cwd: "/repo",
        isOrchestrator: true,
        codexLeaderCompactionMode: "compact",
      },
      {
        containerId: "container-1",
        codexHome,
        codexAgentsSkillsHome: agentsSkillsHome,
        codexHomePrepared: true,
        codexLegacyHome: legacyCodexHome,
        codexLeaderCompactionMode: "compact",
        codexMaxContextLength: 545_000,
        codexSpawnPrepYieldEveryMs: Number.POSITIVE_INFINITY,
        model: "takode-compact-leader",
        env: {
          COMPANION_AUTH_TOKEN: "secret-token",
          COMPANION_PORT: "3456",
          COMPANION_SESSION_ID: "compact-leader",
          COMPANION_SESSION_NUMBER: "2422",
          TAKODE_ROLE: "orchestrator",
        },
      },
    );

    const launchScript = spawn.spawnCmd.join("\n");
    expect(launchScript).toContain("[mcp_servers.takode_delegate]");
    expect(launchScript).toContain('TAKODE_ROLE = "orchestrator"');
    expect(launchScript).toContain("/root/.codex/takode-model-catalog.json");
    expect(launchScript).not.toContain("/root/.codex/takode-leader-model-catalog.json");
    expect(launchScript).toContain("model_context_window = 573685");
    expect(launchScript).not.toContain("model_auto_compact_token_limit = 2725000");
    expect(spawn.codexLeaderRecycleThresholdTokens).toBeUndefined();
  });
});
