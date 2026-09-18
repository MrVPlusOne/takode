import { describe, expect, it, vi } from "vitest";
import { buildCodexRecoveryInstructions } from "./codex-recovery-instructions.js";
import { LEADER_SKILL_PRELOAD_MANIFEST, type LeaderSkillPreloadBundle } from "./leader-skill-preload.js";
import { configureCodexDeveloperInstructions } from "./codex-adapter-initialization.js";

describe("native recovery instruction context", () => {
  it("configures complete mandatory skills once before thread startup without another model input", async () => {
    // Exercise actual manifest assembly and the existing native config path.
    const context = await buildCodexRecoveryInstructions("existing instructions", "leader", "session");
    for (const { skillName } of LEADER_SKILL_PRELOAD_MANIFEST) {
      expect(context?.split(`Required leader skill preloaded: ${skillName}\n`)).toHaveLength(2);
    }
    expect(context).toContain("existing instructions");
    const call = vi.fn().mockResolvedValue({});
    await configureCodexDeveloperInstructions({ call }, context);
    expect(call).toHaveBeenCalledExactlyOnceWith("config/value/write", {
      keyPath: "developer_instructions",
      value: context,
      mergeStrategy: "replace",
    });
  });

  it("preserves the ordinary worker role without loading leader-only skills", async () => {
    const buildSkills = vi.fn<() => Promise<LeaderSkillPreloadBundle[]>>();
    const context = await buildCodexRecoveryInstructions("worker instructions", "standard", "worker", buildSkills);
    expect(context).toContain("worker instructions");
    expect(buildSkills).not.toHaveBeenCalled();
    expect(context).not.toContain("Required leader skill preloaded:");
  });

  it("does not silently start a leader without required instruction sources", async () => {
    const missing = vi.fn().mockRejectedValue(new Error("required skill source missing"));
    await expect(buildCodexRecoveryInstructions("base", "leader", "session", missing)).rejects.toThrow(
      "required skill source missing",
    );
  });

  it("leaves adapters without managed recovery instructions unchanged", async () => {
    expect(await buildCodexRecoveryInstructions("plain", undefined, "session")).toBe("plain");
  });
});
