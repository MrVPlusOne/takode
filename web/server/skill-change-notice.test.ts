import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILL_CHANGE_NOTICE_SOURCE_ID } from "../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  checkSkillChanges,
  findChangedLoadedSkills,
  markSkillChangesChecked,
  recordSkillVersions,
  resetSkillChangeTrackingForTest,
} from "./skill-change-notice.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skill-change-notice-"));
  resetSkillChangeTrackingForTest();
});

afterEach(async () => {
  resetSkillChangeTrackingForTest();
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(name: string, text: string): Promise<void> {
  await mkdir(join(root, "skills", name), { recursive: true });
  await writeFile(join(root, "skills", name, "SKILL.md"), text);
}

function record(now: number) {
  return recordSkillVersions({
    skillNames: ["quest", "confirm", "missing"],
    skillsDir: join(root, "skills"),
    statePath: join(root, "state", "server.json"),
    now,
  });
}

function toolUse(timestamp: number, name: string, input: Record<string, unknown>): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    message: {
      id: `msg-${timestamp}`,
      type: "message",
      role: "assistant",
      model: "test",
      content: [{ type: "tool_use", id: `tool-${timestamp}`, name, input }],
      stop_reason: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as BrowserIncomingMessage;
}

function systemMessage(timestamp: number, sessionId: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    content: "text",
    timestamp,
    agentSource: { sessionId },
  };
}

describe("recordSkillVersions", () => {
  it("records a change time only for skills whose text differs from the previous start", async () => {
    // The first start has nothing to compare with, so nothing counts as changed;
    // later starts keep an unchanged skill's earlier change time.
    await writeSkill("quest", "v1");
    await writeSkill("confirm", "v1");
    expect([...(await record(100))]).toEqual([
      ["quest", 0],
      ["confirm", 0],
    ]);

    await writeSkill("quest", "v2");
    expect([...(await record(200))]).toEqual([
      ["quest", 200],
      ["confirm", 0],
    ]);

    expect([...(await record(300))]).toEqual([
      ["quest", 200],
      ["confirm", 0],
    ]);
    const saved = JSON.parse(await readFile(join(root, "state", "server.json"), "utf-8"));
    expect(saved.quest.changedAt).toBe(200);
  });
});

describe("findChangedLoadedSkills", () => {
  const changeTimes = new Map([
    ["quest", 50],
    ["confirm", 50],
    ["takode-orchestration", 50],
    ["memory", 0],
  ]);

  it("finds skills loaded before their change through preloads, the Skill tool and file reads", () => {
    // Claude loads skills with the Skill tool or Read; Codex reads SKILL.md with
    // shell commands; leaders get preloads. Each counts as a load.
    const history = [
      systemMessage(10, "system:leader-skill-preload:takode-orchestration"),
      toolUse(11, "Skill", { skill: "confirm" }),
      toolUse(12, "Bash", {
        command: "sed -n '1,200p' /home/me/.agents/skills/quest/SKILL.md",
      }),
      toolUse(13, "Read", {
        file_path: "/home/me/.claude/skills/memory/SKILL.md",
      }),
      toolUse(14, "Read", {
        file_path: "/repo/.claude/skills/project-only/SKILL.md",
      }),
    ];
    // memory never changed; project-only is not a tracked skill.
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual(["confirm", "quest", "takode-orchestration"]);
  });

  it("skips skills loaded again after the change", () => {
    const history = [toolUse(10, "Skill", { skill: "quest" }), toolUse(60, "Skill", { skill: "quest" })];
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual([]);
  });

  it("treats an earlier notice as covering every skill loaded before it", () => {
    // A notice named every changed skill, so only a later change counts again.
    const history = [toolUse(10, "Skill", { skill: "quest" }), systemMessage(70, SKILL_CHANGE_NOTICE_SOURCE_ID)];
    expect(findChangedLoadedSkills(history, changeTimes)).toEqual([]);
    expect(findChangedLoadedSkills(history, new Map([["quest", 90]]))).toEqual(["quest"]);
  });
});

describe("checkSkillChanges", () => {
  async function setUpChangedQuest() {
    await writeSkill("quest", "v1");
    await record(100);
    await writeSkill("quest", "v2");
    await record(200);
  }

  function session() {
    return {
      id: "s1",
      messageHistory: [toolUse(150, "Skill", { skill: "quest" })],
    };
  }

  it("adds the notice to the first ordinary input and stops after the session is marked checked", async () => {
    await setUpChangedQuest();
    const target = session();
    const checked = checkSkillChanges(target, {
      type: "user_message",
      content: "Do the work",
    });
    expect(checked?.deliveryContent).toMatch(/^Do the work\n\n\[Skills changed\] .*`quest`/);
    expect(checked?.historyFollowUps).toEqual([
      expect.objectContaining({
        agentSource: expect.objectContaining({
          sessionId: SKILL_CHANGE_NOTICE_SOURCE_ID,
        }),
      }),
    ]);

    markSkillChangesChecked(target);
    expect(checkSkillChanges(target, { type: "user_message", content: "Next" })).toBeNull();
  });

  it("leaves Takode's own system messages for the next ordinary input", async () => {
    // A reminder or recovery message is not new work; the check waits for one.
    await setUpChangedQuest();
    const target = session();
    const reminder = {
      type: "user_message" as const,
      content: "x",
      agentSource: { sessionId: "system:long-sleep-guard" },
    };
    expect(checkSkillChanges(target, reminder)).toBeNull();
    const herd = {
      type: "user_message" as const,
      content: "events",
      agentSource: { sessionId: "herd-events" },
    };
    expect(checkSkillChanges(target, herd)?.deliveryContent).toContain("[Skills changed]");
  });

  it("delivers the input unchanged when no loaded skill changed", async () => {
    await writeSkill("quest", "v1");
    await record(100);
    const message = { type: "user_message" as const, content: "Hi" };
    expect(checkSkillChanges(session(), message)).toBe(message);
  });
});
