import { describe, expect, it } from "vitest";
import { prepareCodexSpawn } from "./cli-launcher-codex.js";

describe("Codex container auth refresh", () => {
  it("refreshes container auth.json from the host Codex mount before every Codex exec", async () => {
    const spec = await prepareCodexSpawn(
      "test-session-id",
      { cwd: "/workspace" },
      {
        containerId: "abc123def456",
        codexSandbox: "workspace-write",
      },
    );

    const bashIndex = spec.spawnCmd.indexOf("-lc");
    expect(bashIndex).toBeGreaterThan(-1);
    const innerScript = spec.spawnCmd[bashIndex + 1];

    // Containers keep /root/.codex writable, so they refresh from the read-only
    // host mount at launch time instead of keeping a stale long-lived copy.
    expect(innerScript).toContain("if [ -f /companion-host-codex/auth.json ]; then");
    expect(innerScript).toContain("rm -f /root/.codex/auth.json");
    expect(innerScript).toContain("cp /companion-host-codex/auth.json /root/.codex/auth.json");
    expect(innerScript.indexOf("cp /companion-host-codex/auth.json")).toBeLessThan(innerScript.indexOf("exec 'codex'"));
  });
});
