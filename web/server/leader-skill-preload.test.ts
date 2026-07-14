import { describe, expect, it, vi } from "vitest";
import {
  buildLeaderPreloadDeliveryContent,
  buildLeaderSkillPreloadBundles,
  buildLeaderSkillPreloadHistoryFollowUps,
  LEADER_SKILL_PRELOAD_MANIFEST,
} from "./leader-skill-preload.js";
import {
  isLeaderSkillPreloadSourceId,
  LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX,
} from "../shared/injected-event-message.js";

describe("leader skill preload builder", () => {
  it("builds one manifest-backed preload bundle per mandatory leader skill", async () => {
    const readFile = vi.fn(async (path: string) => `content for ${path}`);

    const bundles = await buildLeaderSkillPreloadBundles({ packageRoot: "/repo", readFile });

    expect(bundles.map((bundle) => bundle.skillName)).toEqual([
      "takode-orchestration",
      "leader-dispatch",
      "confirm",
      "quest",
    ]);
    expect(LEADER_SKILL_PRELOAD_MANIFEST.find((entry) => entry.skillName === "takode-orchestration")?.files).toEqual([
      ".claude/skills/takode-orchestration/SKILL.md",
      ".claude/skills/takode-orchestration/quest-journey.md",
      ".claude/skills/takode-orchestration/board-usage.md",
    ]);
    expect(LEADER_SKILL_PRELOAD_MANIFEST.find((entry) => entry.skillName === "quest")?.files).toEqual([
      "web/server/templates/quest-skill-docs.md",
    ]);
    expect(readFile).toHaveBeenCalledTimes(6);

    const orchestration = bundles[0]!;
    expect(orchestration.content).toContain("Required leader skill preloaded: takode-orchestration");
    expect(orchestration.content).toContain("Bundle hash: sha256:");
    expect(orchestration.content).toContain(".claude/skills/takode-orchestration/quest-journey.md");
    expect(orchestration.content).toContain("Do not reread this mandatory skill via tool calls");
    expect(orchestration.agentSource.sessionId).toBe(`${LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX}takode-orchestration`);
    expect(isLeaderSkillPreloadSourceId(orchestration.agentSource.sessionId)).toBe(true);
  });

  it("keeps visible preload events separate while model delivery is atomic", async () => {
    const readFile = vi.fn(async (path: string) => `content for ${path}`);
    const bundles = await buildLeaderSkillPreloadBundles({ packageRoot: "/repo", readFile });

    const delivery = buildLeaderPreloadDeliveryContent("Leader kickoff", bundles);
    const followUps = buildLeaderSkillPreloadHistoryFollowUps(bundles);

    expect(delivery).toContain("Leader kickoff");
    expect(delivery).toContain("Required leader skill preloaded: takode-orchestration");
    expect(delivery).toContain("Required leader skill preloaded: quest");
    expect(delivery).toContain("via tool calls");
    expect(followUps).toHaveLength(4);
    expect(followUps[0]?.content).toContain("Required leader skill preloaded: takode-orchestration");
    expect(followUps[0]?.agentSource?.sessionId).toBe(`${LEADER_SKILL_PRELOAD_SOURCE_ID_PREFIX}takode-orchestration`);
  });
});
